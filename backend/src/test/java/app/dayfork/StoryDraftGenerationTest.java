package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class StoryDraftGenerationTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final RecordingModel model = new RecordingModel();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @Test
    void stampsSnapshotMetadataAndPreservesFixedTextSlotsAndDigitBearingNames() throws Exception {
        ObjectNode request = request();
        JsonNode unchanged = request.deepCopy();
        ObjectNode draft = draft();
        model.reply(draft);

        JsonNode result = service.story(request);

        assertEquals("gym-choice_2026", result.path("decisionId").asText());
        assertEquals(137, result.path("simulationVersion").asInt());
        assertEquals(draft.path("sharedScenario"), result.path("sharedScenario"));
        String[] keys = {"morning", "daytime", "evening"};
        String[] ids = {"membership_24", "pay-per-visit"};
        for (int moment = 0; moment < keys.length; moment++) {
            assertEquals(keys[moment], result.path("moments").get(moment).path("key").asText());
            for (int option = 0; option < ids.length; option++) {
                JsonNode entry = result.path("moments").get(moment).path("options").get(option);
                assertEquals(ids[option], entry.path("optionId").asText());
                assertEquals(draft.path(option == 0 ? "optionA" : "optionB").path(keys[moment]), entry.path("text"));
            }
        }
        assertEquals("membership_24", result.path("monthlyReflections").get(0).path("optionId").asText());
        assertEquals("pay-per-visit", result.path("monthlyReflections").get(1).path("optionId").asText());
        assertEquals("{{optionA_name}} has a monthly cost of {{optionA_monthlyCost}} and uses {{optionA_monthlyTime}} of tracked time.",
                result.path("monthlyReflections").get(0).path("text").asText());
        assertEquals("{{optionB_name}} has a monthly cost of {{optionB_monthlyCost}} and uses {{optionB_monthlyTime}} of tracked time.",
                result.path("monthlyReflections").get(1).path("text").asText());
        assertEquals(unchanged, request);
        assertEquals(1, model.requests.size());
        assertFalse(result.has("optionA"));
        validator.response(result, request);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-option", "missing-slot", "empty-slot", "non-text-slot", "unknown-root-field", "unknown-option-field", "unknown-shared-field"})
    void rejectsMalformedDraftsAfterOnlyOneRepair(String defect) throws Exception {
        ObjectNode draft = draft();
        switch (defect) {
            case "missing-option" -> draft.remove("optionB");
            case "missing-slot" -> ((ObjectNode) draft.path("optionA")).remove("evening");
            case "empty-slot" -> ((ObjectNode) draft.path("optionA")).put("morning", " ");
            case "non-text-slot" -> ((ObjectNode) draft.path("optionB")).put("daytime", 20);
            case "unknown-root-field" -> draft.put("recommendation", "Choose membership.");
            case "unknown-option-field" -> ((ObjectNode) draft.path("optionA")).put("score", "high");
            case "unknown-shared-field" -> ((ObjectNode) draft.path("sharedScenario")).put("winner", "Membership");
            default -> throw new IllegalArgumentException(defect);
        }
        model.reply(draft, draft);

        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertTrue(error.issues().getFirst().path().startsWith("storyDraft."));
        assertEquals(2, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"Living here costs {{monthlyCostComparison}} less.\"", "null", "17"})
    void rejectsAnyModelSuppliedMonthlyReflectionSlotInsteadOfDiscardingIt(String reflection) throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionA")).set("monthlyReflection", mapper.readTree(reflection));
        model.reply(draft, draft);

        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals("storyDraft.optionA.monthlyReflection", error.issues().getFirst().path());
        assertEquals(2, model.requests.size());
    }

    @Test
    void repairsAnIncompleteDraftWithoutAskingForIdentityMetadata() throws Exception {
        ObjectNode incomplete = draft();
        ((ObjectNode) incomplete.path("optionB")).remove("evening");
        model.reply(incomplete, draft());

        JsonNode result = service.story(request());

        assertEquals(137, result.path("simulationVersion").asInt());
        assertEquals(2, model.requests.size());
        String repair = model.requests.get(1).getLast().content();
        assertTrue(repair.contains("storyDraft.optionB.evening"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"A workout at 24 Hour Fitness begins.", "The cost is {{inventedCost}}.", "The cost is {{optionA_monthlyCost}."})
    void retainsNarrativeValidationForDrafts(String text) throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionA")).put("morning", text);
        model.reply(draft, draft);

        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals("story.moments[0].options[0].text", error.issues().getFirst().path());
        assertEquals(2, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"decision-id", "simulation-version", "option-id", "moment-order", "extra-field"})
    void neverOverwritesInvalidLegacyStoryMetadata(String defect) throws Exception {
        ObjectNode legacy = (ObjectNode) new StoryDraftAssembler(mapper, contract).assemble(draft(), request());
        switch (defect) {
            case "decision-id" -> legacy.put("decisionId", "another-decision");
            case "simulation-version" -> legacy.put("simulationVersion", 1);
            case "option-id" -> ((ObjectNode) legacy.path("moments").get(0).path("options").get(0)).put("optionId", "another-option");
            case "moment-order" -> ((ObjectNode) legacy.path("moments").get(0)).put("key", "evening");
            case "extra-field" -> legacy.put("winner", "Membership");
            default -> throw new IllegalArgumentException(defect);
        }
        model.reply(legacy, legacy);

        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
    }

    @Test
    void continuesAcceptingValidLegacyStoriesWithoutChangingTheirContent() throws Exception {
        JsonNode legacy = new StoryDraftAssembler(mapper, contract).assemble(draft(), request());
        model.reply(legacy);

        assertEquals(legacy, service.story(request()));
        assertEquals(1, model.requests.size());
    }

    private ObjectNode draft() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {
              "sharedScenario":{"title":"Comparing gym access","description":"The same planned routine applies to both options."},
              "optionA":{
                "morning":"The plan uses {{optionA_name}}.",
                "daytime":"Membership access remains available for the planned activity.",
                "evening":"The membership arrangement carries into the next planned visit."
              },
              "optionB":{
                "morning":"The plan uses {{optionB_name}}.",
                "daytime":"Pay-per-visit access is used for the planned activity.",
                "evening":"The pay-per-visit arrangement carries into the next planned visit."
              }
            }
            """);
    }

    private ObjectNode request() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {
              "snapshot":{
                "decision":{
                  "schemaVersion":1,"id":"gym-choice_2026","title":"Gym access","description":"Recurring costs and routines.",
                  "originalInput":"Membership or pay per visit?","currency":"USD",
                  "options":[
                    {"id":"membership_24","name":"24 Hour Fitness membership","fixedCosts":[],"activities":[]},
                    {"id":"pay-per-visit","name":"Pay per visit","fixedCosts":[],"activities":[]}
                  ],"tags":[]
                },
                "enabledTagIds":[],"simulationVersion":137,
                "calculation":{
                  "status":"valid",
                  "options":[
                    {"optionId":"membership_24","totalCostCents":0,"totalTimeMinutes":0,"breakdown":[]},
                    {"optionId":"pay-per-visit","totalCostCents":0,"totalTimeMinutes":0,"breakdown":[]}
                  ],"comparison":{"costDeltaCents":0,"timeDeltaMinutes":0}
                }
              },
              "context":{"mode":"general"},
              "facts":{
                "optionA_name":"24 Hour Fitness membership","optionB_name":"Pay per visit",
                "optionA_monthlyCost":"$0.00","optionB_monthlyCost":"$0.00",
                "optionA_monthlyTime":"0 hr 0 min","optionB_monthlyTime":"0 hr 0 min",
                "monthlyCostDifference":"$0.00","monthlyTimeDifference":"0 hr 0 min"
              }
            }
            """);
    }

    private final class RecordingModel implements ModelClient {
        private final ArrayDeque<String> responses = new ArrayDeque<>();
        private final List<List<Message>> requests = new ArrayList<>();

        void reply(JsonNode... replies) throws Exception {
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
