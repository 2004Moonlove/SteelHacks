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

class FrequencyLabelGenerationTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();

    @Test
    void repairsTheCapturedDailyLabelWithoutInventingAThirtyDayMultiplier() throws Exception {
        ObjectNode captured = fixture();
        ObjectNode corrected = corrected(captured.deepCopy());
        contract.decision(captured); // Generation-only protection preserves loading compatibility.
        List<List<ModelClient.Message>> requests = new ArrayList<>();
        ArrayDeque<String> replies = new ArrayDeque<>();
        replies.add(mapper.writeValueAsString(captured));
        replies.add(mapper.writeValueAsString(corrected));
        ModelClient model = new ModelClient() {
            @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return replies.remove(); }
            @Override public boolean configured() { return true; }
        };
        GenerationService service = new GenerationService(model, mapper, contract,
                new StoryValidator(contract, new SimulationReconciler(contract, mapper)));
        JsonNode result = service.scenario(captured.path("originalInput").asText());
        assertEquals(2, requests.size());
        assertTrue(requests.get(1).getLast().content().contains("Frequency inputs are monthly counts"));
        assertTrue(requests.get(1).getLast().content().contains("Do not multiply by thirty"));
        for (int i = 0; i < 2; i++) {
            JsonNode activity = result.path("options").get(i).path("activities").get(0);
            assertEquals("Round trips", activity.path("frequencyInput").path("label").asText());
            assertEquals(2, activity.path("frequencyInput").path("eventsPerUnit").asInt());
            assertEquals(captured.path("options").get(i).path("activities").get(0).path("eventsPerMonth"), activity.path("eventsPerMonth"));
            assertTrue(activity.path("eventsPerMonth").path("value").isNull());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"Round trips per day", "Trips per week", "Daily campus visits", "Weekly attendance", "Trips/day", "Trips per-week"})
    void rejectsUnsupportedDailyOrWeeklyCountingLabels(String label) throws Exception {
        ObjectNode decision = corrected(fixture());
        ((ObjectNode) decision.path("options").get(0).path("activities").get(0).path("frequencyInput")).put("label", label);
        var error = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        assertEquals("decision.options[0].activities[0].frequencyInput.label", error.path());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Round trips", "Campus days", "Trips per month"})
    void preservesMonthlyUnitsAndTheirKnownEventConversion(String label) throws Exception {
        ObjectNode decision = corrected(fixture());
        ((ObjectNode) decision.path("options").get(0).path("activities").get(0).path("frequencyInput")).put("label", label);
        contract.generatedDecision(decision);
    }

    private ObjectNode corrected(ObjectNode decision) {
        for (JsonNode option : decision.path("options")) {
            for (JsonNode activity : option.path("activities")) {
                ((ObjectNode) activity.path("frequencyInput")).put("label", "Round trips");
            }
        }
        return decision;
    }

    private ObjectNode fixture() throws Exception {
        try (var stream = getClass().getResourceAsStream("/campus-frequency-label-invalid.json")) { return (ObjectNode) mapper.readTree(stream); }
    }
}
