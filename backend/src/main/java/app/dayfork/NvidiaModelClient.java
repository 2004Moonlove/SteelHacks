package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class NvidiaModelClient implements ModelClient {
    private static final Logger log = LoggerFactory.getLogger(NvidiaModelClient.class);
    private static final Set<Integer> RETRYABLE_STATUSES = Set.of(429, 500, 502, 503, 504);
    private static final Duration RETRY_WINDOW = Duration.ofSeconds(10);
    private static final Duration MAX_RETRY_DELAY = Duration.ofSeconds(2);
    private final RestClient client;
    private final ObjectMapper mapper;
    private final String apiKey;
    private final String model;
    private final String url;

    public NvidiaModelClient(ObjectMapper mapper,
            @Value("${nvidia.api-key:}") String apiKey,
            @Value("${nvidia.model:}") String model,
            @Value("${nvidia.url}") String url,
            @Value("${nvidia.timeout-seconds:60}") int timeoutSeconds) {
        this.mapper = mapper;
        this.apiKey = apiKey;
        this.model = model;
        this.url = url;
        int timeout = Math.max(1, timeoutSeconds);
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(Math.min(timeout, 10)));
        factory.setReadTimeout(Duration.ofSeconds(timeout));
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public boolean configured() {
        return !apiKey.isBlank() && !model.isBlank();
    }

    @Override
    public String complete(List<Message> messages) {
        if (!configured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_NOT_CONFIGURED",
                    "Model access is not configured. Set NVIDIA_API_KEY and NVIDIA_MODEL.");
        }
        long started = System.nanoTime();
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                String body = client.post().uri(url)
                        .header("Authorization", "Bearer " + apiKey)
                        .body(Map.of("model", model, "messages", messages, "stream", false))
                        .retrieve().body(String.class);
                JsonNode response = body == null || body.isBlank() ? null : mapper.readTree(body);
                JsonNode content = response == null ? null
                        : response.path("choices").path(0).path("message").path("content");
                if (content == null || !content.isTextual() || content.asText().isBlank()) {
                    throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_RESPONSE_INVALID",
                            "The model returned an empty response.");
                }
                log.info("Model request completed: attempt={}, elapsedMs={}", attempt, elapsedMillis(started));
                return content.asText();
            } catch (RestClientResponseException exception) {
                int status = exception.getStatusCode().value();
                Duration delay = retryDelay(exception.getResponseHeaders());
                boolean retry = attempt == 1 && RETRYABLE_STATUSES.contains(status) && delay != null
                        && elapsedMillis(started) + delay.toMillis() < RETRY_WINDOW.toMillis();
                // Never log credentials, prompts, provider response bodies, or exception messages.
                log.warn("Model request rejected: upstreamStatus={}, attempt={}, elapsedMs={}, retry={}",
                        status, attempt, elapsedMillis(started), retry);
                if (!retry) throw upstreamError(status);
                pauseBeforeRetry(delay);
            } catch (RestClientException exception) {
                log.warn("Model transport failed: cause={}, attempt={}, elapsedMs={}",
                        exception.getMostSpecificCause().getClass().getSimpleName(), attempt, elapsedMillis(started));
                if (exception instanceof ResourceAccessException || exception.getMostSpecificCause() instanceof IOException) {
                    throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "MODEL_UNAVAILABLE",
                            "The model service timed out or could not be reached. Please retry.");
                }
                throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_RESPONSE_INVALID",
                        "The model returned an unreadable response. Please retry.");
            } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_RESPONSE_INVALID",
                        "The model returned an unreadable response.");
            }
        }
        throw new IllegalStateException("Model request attempts exhausted.");
    }

    private static long elapsedMillis(long started) {
        return Duration.ofNanos(System.nanoTime() - started).toMillis();
    }

    private static Duration retryDelay(HttpHeaders headers) {
        String value = headers == null ? null : headers.getFirst(HttpHeaders.RETRY_AFTER);
        if (value == null) return Duration.ofSeconds(1);
        try {
            Duration delay = value.trim().matches("[0-9]+")
                    ? Duration.ofSeconds(Long.parseLong(value.trim()))
                    : Duration.between(Instant.now(), ZonedDateTime.parse(value.trim(), DateTimeFormatter.RFC_1123_DATE_TIME).toInstant());
            if (delay.isNegative()) delay = Duration.ZERO;
            return delay.compareTo(MAX_RETRY_DELAY) <= 0 ? delay : null;
        } catch (NumberFormatException | DateTimeParseException | ArithmeticException exception) {
            // Do not retry early when the provider's requested wait cannot be interpreted.
            return null;
        }
    }

    private static void pauseBeforeRetry(Duration delay) {
        try {
            Thread.sleep(delay.toMillis());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_UNAVAILABLE",
                    "The model request was interrupted. Please retry.");
        }
    }

    private static ApiException upstreamError(int status) {
        if (status == 401 || status == 403) {
            return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_ACCESS_DENIED",
                    "The model service rejected this app's access. Check the API key and model permissions.");
        }
        if (status == 404) {
            return new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_NOT_FOUND",
                    "The configured model endpoint was not found. Check the model and endpoint settings.");
        }
        if (status == 400 || status == 422) {
            return new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_REQUEST_REJECTED",
                    "The model service rejected the request. Check the model configuration.");
        }
        if (status == 429) {
            return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_RATE_LIMITED",
                    "The model service is limiting requests. Please try again later.");
        }
        if (status >= 500) {
            return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_UNAVAILABLE",
                    "The model service is temporarily unavailable. Please try again shortly.");
        }
        return new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_UPSTREAM_ERROR",
                "The model service could not complete the request. Please retry.");
    }
}
