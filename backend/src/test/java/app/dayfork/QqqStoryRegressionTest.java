package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** The captured synthetic request is validation data, not verified investment guidance. */
class QqqStoryRegressionTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));

    @Test
    void acceptsTheLiveQqqRequestWithoutConvertingInvestmentIntoMonthlyExpenses() throws Exception {
        JsonNode request = request();
        validator.request(request);
        assertEquals("qualitative", request.path("snapshot").path("calculation").path("status").asText());
        assertEquals(2, request.path("facts").size());
        assertTrue(request.path("snapshot").path("decision").path("description").asText().contains("Nasdaq-100"));
        JsonNode projection = new StoryModelInput(mapper).project(request);
        assertEquals(4, projection.path("optionA").path("selectedConsiderations").size());
        assertFalse(projection.toString().contains("monthlyCost"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Nasdaq-100", "5–10 years", "6%", "$1000"})
    void repairsUnsupportedLiteralCopyingWithoutRelaxingNumericSafety(String literal) throws Exception {
        JsonNode request = request();
        ObjectNode invalid = draft();
        ((ObjectNode) invalid.path("sharedScenario")).put("description", "Consider " + literal + " in the comparison.");
        ArrayDeque<String> replies = new ArrayDeque<>(List.of(mapper.writeValueAsString(invalid), mapper.writeValueAsString(draft())));
        List<List<ModelClient.Message>> calls = new ArrayList<>();
        ModelClient model = new ModelClient() {
            public String complete(List<Message> messages) { calls.add(List.copyOf(messages)); return replies.remove(); }
            public boolean configured() { return true; }
        };
        JsonNode result = new GenerationService(model, mapper, contract, validator).story(request);
        assertEquals("qualitative", result.path("mode").asText());
        assertEquals(2, calls.size());
        assertTrue(calls.get(1).getLast().content().contains("Found literal"));
        assertTrue(calls.getFirst().getFirst().content().contains("A question can contain an unverified premise"));
        assertEquals(calls.get(0).get(1).content(), calls.get(1).get(1).content());
    }

    private JsonNode request() throws Exception {
        try (var input = getClass().getResourceAsStream("/story-qqq-request.json")) { return mapper.readTree(input); }
    }

    private ObjectNode draft() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {"sharedScenario":{"title":"Comparing investment paths","description":"The same selected needs apply to both choices."},
             "optionA":{"beginning":"Consider whether {{optionA_name}} fits your stated tolerance for loss.","during":"If access to funds matters, check how the actual investment arrangement fits that need.","later":"You could revisit whether the selected needs have changed."},
             "optionB":{"beginning":"Consider whether {{optionB_name}} fits your stated tolerance for loss.","during":"If access to funds matters, check how the actual deposit terms fit that need.","later":"You could revisit whether the selected needs have changed."}}
            """);
    }
}
