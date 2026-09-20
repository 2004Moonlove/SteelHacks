package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RideshareGenerationTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();

    @Test
    void repairsTheCapturedRideshareAdditionToUseItsOwnUnknownPriceAndDuration() throws Exception {
        ObjectNode captured = fixture();
        contract.decision(captured); // Existing saved data keeps its established schema compatibility.
        ObjectNode corrected = captured.deepCopy();
        ObjectNode tag = rideshareTag(corrected);
        tag.put("type", "replace_activity").put("description", "Take some existing commute trips by rideshare instead.");
        for (JsonNode target : tag.path("targets")) {
            ObjectNode replacement = (ObjectNode) target;
            replacement.put("replacementName", "Rideshare");
            replacement.putObject("costCentsPerEvent").putNull("value").put("source", "unknown");
            replacement.putObject("minutesPerEvent").putNull("value").put("source", "unknown");
        }
        List<List<ModelClient.Message>> requests = new ArrayList<>();
        ArrayDeque<String> replies = new ArrayDeque<>();
        replies.add(mapper.writeValueAsString(captured));
        replies.add(mapper.writeValueAsString(corrected));
        ModelClient model = new ModelClient() {
            @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return replies.remove(); }
            @Override public boolean configured() { return true; }
        };
        var service = new GenerationService(model, mapper, contract,
                new StoryValidator(contract, new SimulationReconciler(contract, mapper)));
        JsonNode result = service.scenario(captured.path("originalInput").asText());
        assertEquals(2, requests.size());
        String repair = requests.get(1).getLast().content();
        assertTrue(repair.contains("inherit the ordinary baseline commute's price and time"));
        assertTrue(repair.contains("use replace_activity"));
        JsonNode resultTag = result.path("tags").get(3);
        assertEquals("replace_activity", resultTag.path("type").asText());
        assertTrue(resultTag.path("targets").get(0).path("costCentsPerEvent").path("value").isNull());
        assertTrue(resultTag.path("targets").get(0).path("minutesPerEvent").path("value").isNull());
        assertEquals(captured.path("options"), result.path("options"));
    }

    @Test
    void rejectsEachExplicitAlternativeTransportAgainstGenericBaselineEvenWhenCalledExtra() throws Exception {
        for (String transport : List.of("rideshare", "Uber", "Lyft", "taxi")) {
            ObjectNode decision = fixture();
            rideshareTag(decision).put("name", "Extra " + transport + " trips").put("description", "Additional trips using " + transport + ".");
            var error = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision), transport);
            assertEquals("decision.tags[3]", error.path());
        }
    }

    @Test
    void permitsRealAdditionalRideshareEventsAndOrdinaryExtraCommutes() throws Exception {
        for (String transport : List.of("rideshare", "Uber", "Lyft", "taxi")) {
            ObjectNode decision = fixture();
            rideshareTag(decision).put("name", "Extra " + transport + " trips").put("description", "Additional trips using the existing transport.");
            ((ObjectNode) decision.path("options").get(1).path("activities").get(0)).put("name", transport + " commute to classes");
            contract.generatedDecision(decision);
        }
        ObjectNode ordinary = fixture();
        rideshareTag(ordinary).put("name", "Extra campus visits").put("description", "Additional trips using the existing commute.");
        contract.generatedDecision(ordinary);
    }

    private ObjectNode rideshareTag(ObjectNode decision) { return (ObjectNode) decision.path("tags").get(3); }
    private ObjectNode fixture() throws Exception {
        try (var stream = getClass().getResourceAsStream("/campus-rideshare-add-invalid.json")) { return (ObjectNode) mapper.readTree(stream); }
    }
}
