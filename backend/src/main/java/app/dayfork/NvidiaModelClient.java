package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class NvidiaModelClient implements ModelClient {
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
        try {
            String body = client.post().uri(url)
                    .header("Authorization", "Bearer " + apiKey)
                    .body(Map.of("model", model, "messages", messages, "stream", false))
                    .retrieve().body(String.class);
            JsonNode content = mapper.readTree(body).path("choices").path(0).path("message").path("content");
            if (!content.isTextual() || content.asText().isBlank()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_RESPONSE_INVALID",
                        "The model returned an empty response.");
            }
            return content.asText();
        } catch (RestClientResponseException exception) {
            HttpStatus status = exception.getStatusCode().value() == 429
                    ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
            throw new ApiException(status, "MODEL_UPSTREAM_ERROR",
                    "The model service could not complete the request. Please retry.");
        } catch (RestClientException exception) {
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
}
