package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;

class NvidiaModelClientTest {
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
