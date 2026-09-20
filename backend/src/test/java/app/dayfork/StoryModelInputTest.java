package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class StoryModelInputTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final RecordingModel model = new RecordingModel();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @ParameterizedTest
    @ValueSource(strings = {"general", "campus"})
    void sendsOnlyConfiguredRoutinesAndCanonicalFactsWhilePreservingThePublicStory(String mode) throws Exception {
        ObjectNode request = request(mode);
        ((ObjectNode) request.path("snapshot").path("decision")).put("originalInput", "Private original input with raw amounts 12345.");
        JsonNode original = request.deepCopy();
        model.reply(draft());

        JsonNode story = service.story(request);
        JsonNode input = mapper.readTree(model.requests.getFirst().get(1).content());

        assertEquals(4, input.size());
        assertEquals(mode, input.path("context").path("mode").asText());
        assertEquals(1, input.path("context").size());
        assertEquals(request.path("facts"), input.path("facts"));
        assertEquals("{{optionA_name}}", input.path("optionA").path("nameFact").asText());
        assertEquals("{{optionB_name}}", input.path("optionB").path("nameFact").asText());
        assertEquals(0, input.path("optionA").path("enabledAdjustments").size());
        assertEquals(1, input.path("optionB").path("enabledAdjustments").size());
        assertEquals("Take an Uber after class", input.path("optionB").path("enabledAdjustments").get(0).path("name").asText());
        JsonNode replacement = input.path("optionB").path("activities").get(1);
        assertEquals("Uber ride", replacement.path("label").asText());
        assertEquals("replacement_activity", replacement.path("kind").asText());
        assertEquals("one_way_trip", replacement.path("eventUnit").asText());
        assertTrue(replacement.path("hasMonthlyEvents").asBoolean());
        assertFalse(input.toString().contains("Private original input"));
        assertFalse(input.toString().contains("Buy a transit pass"));
        assertProjectionHasNoRawSnapshotFields(input);
        if (mode.equals("campus")) {
            assertEquals("Uber ride", input.path("facts").path("optionB_inboundMode").asText());
            assertEquals("9:20 PM", input.path("facts").path("optionB_arriveHome").asText());
        }
        assertEquals(original, request);
        assertEquals(request.path("snapshot").path("decision").path("id"), story.path("decisionId"));
        assertEquals(request.path("snapshot").path("simulationVersion"), story.path("simulationVersion"));
        validator.response(story, request);
        assertEquals("{{optionA_name}} has a monthly cost of {{optionA_monthlyCost}} and uses {{optionA_monthlyTime}} of tracked time.",
                story.path("monthlyReflections").get(0).path("text").asText());
        assertEquals("{{optionB_name}} has a monthly cost of {{optionB_monthlyCost}} and uses {{optionB_monthlyTime}} of tracked time.",
                story.path("monthlyReflections").get(1).path("text").asText());
        assertEquals(1, model.requests.size());
    }

    @Test
    void preservesZeroActivityPresenceAndEnabledFixedCostWithoutInventingActivity() throws Exception {
        ObjectNode request = request("general");
        ObjectNode snapshot = (ObjectNode) request.path("snapshot");
        ((ArrayNode) snapshot.path("enabledTagIds")).add("transit-pass");
        ((ObjectNode) snapshot.path("decision").path("options").get(0).path("activities").get(0).path("eventsPerMonth")).put("value", 0);
        ObjectNode near = (ObjectNode) snapshot.path("calculation").path("options").get(0);
        near.put("totalTimeMinutes", 0);
        ((ObjectNode) near.path("breakdown").get(1)).put("eventsPerMonth", 0).put("totalTimeMinutes", 0);
        ObjectNode far = (ObjectNode) snapshot.path("calculation").path("options").get(1);
        far.put("totalCostCents", 134750);
        ((ArrayNode) far.path("breakdown")).addObject().put("id", "far:transit-pass:fixed")
                .put("kind", "tag_fixed").put("label", "Buy a transit pass").put("tagId", "transit-pass")
                .put("totalCostCents", 9750).put("totalTimeMinutes", 0);
        ((ObjectNode) snapshot.path("calculation").path("comparison")).put("costDeltaCents", -15250).put("timeDeltaMinutes", 1480);
        ObjectNode facts = (ObjectNode) request.path("facts");
        facts.put("optionA_monthlyTime", "0 hr 0 min").put("optionB_monthlyCost", "$1,347.50")
                .put("monthlyCostDifference", "$152.50").put("monthlyTimeDifference", "24 hr 40 min")
                .put("monthlyCostComparison", "Near campus costs $152.50 more per month than Farther away.")
                .put("monthlyTimeComparison", "Farther away uses 24 hr 40 min more per month than Near campus.");
        validator.request(request);

        JsonNode input = new StoryModelInput(mapper).project(request);

        assertFalse(input.path("optionA").path("activities").get(0).path("hasMonthlyEvents").asBoolean());
        JsonNode fixed = input.path("optionB").path("recurringItems").get(1);
        assertEquals("Buy a transit pass", fixed.path("label").asText());
        assertEquals("tag_fixed", fixed.path("kind").asText());
        assertTrue(fixed.path("hasMonthlyCost").asBoolean());
        assertFalse(fixed.path("hasTrackedTime").asBoolean());
        assertEquals(2, input.path("optionB").path("enabledAdjustments").size());
        assertEquals(2, input.path("optionB").path("activities").size());
        assertProjectionHasNoRawSnapshotFields(input);
    }

    @Test
    void rejectsContradictoryFactsBeforeProjectionOrModelCalls() throws Exception {
        ObjectNode request = request("general");
        ((ObjectNode) request.path("facts")).put("optionA_monthlyCost", "$1.00");

        ApiException error = assertThrows(ApiException.class, () -> service.story(request));

        assertEquals("INVALID_REQUEST", error.code());
        assertEquals(0, model.requests.size());
    }

    @Test
    void keepsTheSameProjectedInputForTheExistingBoundedRepair() throws Exception {
        ObjectNode invalid = draft();
        ((ObjectNode) invalid.path("sharedScenario")).put("title", "A day with 3 trips");
        model.reply(invalid, draft());

        service.story(request("general"));

        assertEquals(2, model.requests.size());
        assertEquals(model.requests.get(0).get(1).content(), model.requests.get(1).get(1).content());
        assertProjectionHasNoRawSnapshotFields(mapper.readTree(model.requests.get(1).get(1).content()));
    }

    private void assertProjectionHasNoRawSnapshotFields(JsonNode node) {
        Set<String> forbidden = Set.of("snapshot", "decision", "id", "optionId", "activityId", "tagId", "schemaVersion",
                "simulationVersion", "originalInput", "source", "value", "calculation", "enabledTagIds",
                "eventsPerMonth", "minutesPerEvent", "costCentsPerEvent", "totalCostCents", "totalTimeMinutes", "selections");
        assertFalse(node.isNumber(), "Raw numeric values must not be model-facing.");
        if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                assertFalse(forbidden.contains(entry.getKey()), "Unexpected raw snapshot field: " + entry.getKey());
                assertProjectionHasNoRawSnapshotFields(entry.getValue());
            });
        } else if (node.isArray()) node.forEach(this::assertProjectionHasNoRawSnapshotFields);
    }

    private ObjectNode request(String mode) throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-" + mode + "-request.json")) {
            return (ObjectNode) mapper.readTree(stream);
        }
    }

    private ObjectNode draft() throws IOException {
        return (ObjectNode) mapper.readTree("""
            {"sharedScenario":{"title":"Comparing {{optionA_name}} and {{optionB_name}}","description":"A shared look at the configured routines."},
             "optionA":{"morning":"The plan includes the configured commute.","daytime":"The comparison assigns no additional activity to this moment.","evening":"The monthly arrangement remains unchanged."},
             "optionB":{"morning":"The plan includes the configured commute.","daytime":"The comparison assigns no additional activity to this moment.","evening":"The monthly arrangement remains unchanged."}}
            """);
    }

    private final class RecordingModel implements ModelClient {
        private final ArrayDeque<String> responses = new ArrayDeque<>();
        private final List<List<Message>> requests = new ArrayList<>();

        void reply(JsonNode... replies) throws IOException {
            for (JsonNode reply : replies) responses.add(mapper.writeValueAsString(reply));
        }

        @Override
        public String complete(List<Message> messages) {
            requests.add(List.copyOf(messages));
            return responses.remove();
        }

        @Override
        public boolean configured() { return true; }
    }
}
