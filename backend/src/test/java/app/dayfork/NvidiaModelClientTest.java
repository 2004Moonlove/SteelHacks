package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpStatus;

class NvidiaModelClientTest {
    @ParameterizedTest
    @ValueSource(ints = {429, 500, 502, 503, 504})
    void recoversFromOneTemporaryRejectionWithTheSameRequest(int status) throws Exception {
        try (var provider = new ProviderStub(new Reply(status, "Temporary failure", "0"), successfulReply())) {
            assertEquals("Generated content", provider.client().complete(messages()));
            assertEquals(2, provider.requests.size());
            assertEquals(provider.requests.get(0), provider.requests.get(1));
        }
    }

    @Test
    void boundsReasoningForTheSupportedModelWithoutReducingTheContentTokenLimit() throws Exception {
        try (var provider = new ProviderStub(successfulReply())) {
            assertEquals("Generated content", provider.client("nvidia/nemotron-3-super-120b-a12b").complete(messages()));
            var request = new ObjectMapper().readTree(provider.requests.getFirst());
            assertEquals("nvidia/nemotron-3-super-120b-a12b", request.path("model").asText());
            assertEquals(1024, request.path("reasoning_budget").asInt());
            assertTrue(request.path("chat_template_kwargs").path("enable_thinking").asBoolean());
            assertTrue(request.path("chat_template_kwargs").path("low_effort").asBoolean());
            assertFalse(request.has("max_tokens"));
            assertEquals(new ObjectMapper().valueToTree(messages()), request.path("messages"));
            assertEquals(1, provider.requests.size());
        }
    }

    @Test
    void preservesSupportedModelReasoningControlsAcrossTheExistingRetry() throws Exception {
        try (var provider = new ProviderStub(new Reply(503, "Busy", "0"), successfulReply())) {
            assertEquals("Generated content", provider.client("nvidia/nemotron-3-super-120b-a12b").complete(messages()));
            assertEquals(2, provider.requests.size());
            assertEquals(provider.requests.getFirst(), provider.requests.getLast());
            var request = new ObjectMapper().readTree(provider.requests.getFirst());
            assertEquals(1024, request.path("reasoning_budget").asInt());
            assertTrue(request.path("chat_template_kwargs").path("low_effort").asBoolean());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"test-model", "nvidia/nemotron-3-nano-30b-a3b", "nvidia/nemotron-3-super-120b-a12b-custom"})
    void leavesOtherModelRequestsUnchanged(String model) throws Exception {
        try (var provider = new ProviderStub(successfulReply())) {
            assertEquals("Generated content", provider.client(model).complete(messages()));
            var request = new ObjectMapper().readTree(provider.requests.getFirst());
            assertEquals(new ObjectMapper().valueToTree(Map.of("model", model, "messages", messages(), "stream", false)), request);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "{\"title\":\"unfinished", "{}"})
    void reportsProviderTruncationBeforeParsingOrRepairingContent(String content) throws Exception {
        String body = new ObjectMapper().writeValueAsString(Map.of("choices",
                List.of(Map.of("finish_reason", "length", "message", Map.of("content", content)))));
        try (var provider = new ProviderStub(new Reply(200, body, null), successfulReply())) {
            ApiException error = assertThrows(ApiException.class, () -> provider.client().complete(messages()));
            assertEquals("MODEL_RESPONSE_TRUNCATED", error.code());
            assertEquals(HttpStatus.BAD_GATEWAY, error.status());
            assertTrue(error.getMessage().contains("Please retry"));
            assertEquals(1, provider.requests.size());
        }
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void stopsAfterOneRetryAndDoesNotExposeProviderBody(CapturedOutput output) throws Exception {
        String privateBody = "Private provider response containing test-key and the full user prompt";
        try (var provider = new ProviderStub(new Reply(503, privateBody, "0"))) {
            ApiException error = assertThrows(ApiException.class, () -> provider.client().complete(messages()));
            assertEquals("MODEL_UNAVAILABLE", error.code());
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.status());
            assertEquals(2, provider.requests.size());
            assertFalse(error.getMessage().contains(privateBody));
            assertFalse(output.toString().contains("test-key"));
            assertFalse(output.toString().contains("full user prompt"));
        }
    }

    @ParameterizedTest
    @CsvSource({
            "400, MODEL_REQUEST_REJECTED, 502",
            "401, MODEL_ACCESS_DENIED, 503",
            "403, MODEL_ACCESS_DENIED, 503",
            "404, MODEL_NOT_FOUND, 502",
            "422, MODEL_REQUEST_REJECTED, 502"
    })
    void reportsConfigurationErrorsWithoutRetrying(int status, String code, int localStatus) throws Exception {
        try (var provider = new ProviderStub(new Reply(status, "Provider details", "0"))) {
            ApiException error = assertThrows(ApiException.class, () -> provider.client().complete(messages()));
            assertEquals(code, error.code());
            assertEquals(localStatus, error.status().value());
            assertEquals(1, provider.requests.size());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"60", "Fri, 01 Jan 2100 00:00:00 GMT", "invalid"})
    void doesNotRetryBeforeALongerOrUnrecognizedProviderWait(String retryAfter) throws Exception {
        try (var provider = new ProviderStub(new Reply(429, "Rate limit", retryAfter))) {
            ApiException error = assertThrows(ApiException.class, () -> provider.client().complete(messages()));
            assertEquals("MODEL_RATE_LIMITED", error.code());
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, error.status());
            assertEquals(1, provider.requests.size());
        }
    }

    @Test
    void retriesWhenTheProviderWaitDateHasPassed() throws Exception {
        try (var provider = new ProviderStub(new Reply(503, "Busy", "Sat, 01 Jan 2000 00:00:00 GMT"), successfulReply())) {
            assertEquals("Generated content", provider.client().complete(messages()));
            assertEquals(2, provider.requests.size());
        }
    }

    @Test
    void recoversWhenTheProviderOmitsRetryAfter() throws Exception {
        try (var provider = new ProviderStub(new Reply(503, "Busy", null), successfulReply())) {
            assertEquals("Generated content", provider.client().complete(messages()));
            assertEquals(2, provider.requests.size());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "null", "{}", "not json"})
    void reportsEmptyOrUnreadableSuccessResponsesWithoutRetrying(String body) throws Exception {
        try (var provider = new ProviderStub(new Reply(200, body, null))) {
            ApiException error = assertThrows(ApiException.class, () -> provider.client().complete(messages()));
            assertEquals("MODEL_RESPONSE_INVALID", error.code());
            assertEquals(1, provider.requests.size());
        }
    }

    private static List<ModelClient.Message> messages() {
        return List.of(new ModelClient.Message("user", "Compare two choices"));
    }

    private static Reply successfulReply() throws Exception {
        String body = new ObjectMapper().writeValueAsString(Map.of("choices",
                List.of(Map.of("message", Map.of("content", "Generated content")))));
        return new Reply(200, body, null);
    }

    private record Reply(int status, String body, String retryAfter) {}

    private static final class ProviderStub implements AutoCloseable {
        private final HttpServer server;
        private final List<String> requests = new CopyOnWriteArrayList<>();

        ProviderStub(Reply... replies) throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/chat/completions", exchange -> {
                int index = requests.size();
                requests.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                Reply reply = replies[Math.min(index, replies.length - 1)];
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                if (reply.retryAfter() != null) exchange.getResponseHeaders().set("Retry-After", reply.retryAfter());
                byte[] body = reply.body().getBytes(StandardCharsets.UTF_8);
                try {
                    exchange.sendResponseHeaders(reply.status(), body.length);
                    exchange.getResponseBody().write(body);
                } finally {
                    exchange.close();
                }
            });
            server.start();
        }

        NvidiaModelClient client() {
            return client("test-model");
        }

        NvidiaModelClient client(String model) {
            return new NvidiaModelClient(new ObjectMapper(), "test-key", model,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/chat/completions", 1);
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void reportsTimeoutWhileReadingHeadersOrBodyWithoutRetrying(boolean sendHeaders) throws Exception {
        var release = new CountDownLatch(1);
        var requests = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            requests.incrementAndGet();
            try {
                exchange.getRequestBody().readAllBytes();
                if (sendHeaders) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, 0);
                    exchange.getResponseBody().write("{\"choices\":[".getBytes(StandardCharsets.UTF_8));
                    exchange.getResponseBody().flush();
                }
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            var client = new NvidiaModelClient(new ObjectMapper(), "test-key", "test-model",
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/chat/completions", 1);

            ApiException error = assertThrows(ApiException.class,
                    () -> client.complete(List.of(new ModelClient.Message("user", "Compare two choices"))));

            assertEquals("MODEL_UNAVAILABLE", error.code());
            assertEquals(HttpStatus.GATEWAY_TIMEOUT, error.status());
            assertEquals(1, requests.get());
        } finally {
            release.countDown();
            server.stop(0);
        }
    }
}
