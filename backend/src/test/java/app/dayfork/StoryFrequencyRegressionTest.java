package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class StoryFrequencyRegressionTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));

    @Test
    void repairsTheCapturedInventedAttendanceWithoutAddingFrequencyFacts() throws Exception {
        ObjectNode request = fixture("story-frequency-request.json");
        ObjectNode response = fixture("story-frequency-invalid-response.json");
        validator.request(request);
        var error = assertThrows(ContractValidator.ContractException.class, () -> validator.response(response, request));
        assertEquals("story.sharedScenario.description", error.path());
        ArrayDeque<String> replies = new ArrayDeque<>();
        replies.add(mapper.writeValueAsString(response));
        replies.add(mapper.writeValueAsString(correctedResponse()));
        List<List<ModelClient.Message>> calls = new ArrayList<>();
        ModelClient model = new ModelClient() {
            @Override public String complete(List<Message> messages) { calls.add(List.copyOf(messages)); return replies.remove(); }
            @Override public boolean configured() { return true; }
        };
        JsonNode originalFacts = request.path("facts").deepCopy();
        JsonNode result = new GenerationService(model, mapper, contract, validator).story(request);
        assertEquals(2, calls.size());
        assertTrue(calls.get(1).getLast().content().contains("Spelled-out usage frequencies are numerical claims"));
        assertTrue(calls.get(1).getLast().content().contains("when you use the gym"));
        assertEquals(originalFacts, request.path("facts"));
        validator.response(result, request);
    }

    @Test
    void rejectsAllObservedForwardAndReverseFrequencyPhrasesIndependently() throws Exception {
        for (String text : List.of("You plan to go three times a week after work.",
                "Three evenings each week you swipe the card.", "Each week you go to the gym three times in the evenings.")) {
            ObjectNode response = correctedResponse();
            during(response).put("text", text);
            var error = assertThrows(ContractValidator.ContractException.class,
                    () -> validator.response(response, fixture("story-frequency-request.json")), text);
            assertEquals("story.moments[1].options[0].text", error.path());
        }
    }

    @Test
    void rejectsExplicitNumberWordsWithUsageUnitsAndCalendarPeriods() throws Exception {
        for (String text : List.of("You visit once a day.", "You attend twice per month.",
                "You plan twelve visits each month.", "You arrange one session every week.", "You drink two cups per day.")) {
            ObjectNode response = correctedResponse();
            during(response).put("text", text);
            assertThrows(ContractValidator.ContractException.class,
                    () -> validator.response(response, fixture("story-frequency-request.json")), text);
        }
    }

    @Test
    void preservesOrdinalNarrativeAndOrdinaryOptionLanguage() throws Exception {
        for (String text : List.of("In the first month, you begin to settle into the arrangement.",
                "You choose one of the options and see how it fits your needs.", "The two paths respond to the same possible change in schedule.",
                "When you use the gym, you swipe the card and begin your routine.")) {
            ObjectNode response = correctedResponse();
            during(response).put("text", text);
            validator.response(response, fixture("story-frequency-request.json"));
        }
    }

    private ObjectNode during(ObjectNode response) { return (ObjectNode) response.path("moments").get(1).path("options").get(0); }

    private ObjectNode correctedResponse() throws Exception {
        ObjectNode response = fixture("story-frequency-invalid-response.json");
        ((ObjectNode) response.path("sharedScenario")).put("description", "Imagine your work schedule changing while you fit gym access around the same evening routine. {{subscriptionCostComparison}}");
        during(response).put("text", "When you use the gym, you swipe the card and begin your routine under the prepaid arrangement.");
        ((ObjectNode) response.path("moments").get(1).path("options").get(1)).put("text", "When you use the gym, you swipe the card and begin your routine while preparing for the next stated payment.");
        return response;
    }

    private ObjectNode fixture(String name) throws Exception {
        try (var stream = getClass().getResourceAsStream("/" + name)) { return (ObjectNode) mapper.readTree(stream); }
    }
}
