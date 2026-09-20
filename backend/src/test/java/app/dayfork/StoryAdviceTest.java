package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class StoryAdviceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @ParameterizedTest
    @ValueSource(strings = {"general", "qualitative", "break-even"})
    void bindsConcretePairedAdviceToTheSnapshotAndKeepsHypotheticalScenes(String mode) throws Exception {
        ObjectNode request = request(mode);
        ObjectNode draft = draft(mode);
        model.reply(draft);
        JsonNode result = service.story(request);
        assertEquals(2, result.path("advice").size());
        for (int i = 0; i < 2; i++) {
            assertEquals(request.path("snapshot").path("decision").path("options").get(i).path("id"), result.path("advice").get(i).path("optionId"));
            assertEquals(draft.path(i == 0 ? "optionA" : "optionB").path("advice"), result.path("advice").get(i).path("text"));
        }
        assertTrue(model.requests.getFirst().getFirst().content().contains("hypothetical"));
        assertTrue(model.requests.getFirst().getFirst().content().contains("advice:string"));
        assertEquals(1, model.requests.size());
        if (mode.equals("general")) {
            String prompt = model.requests.getFirst().getFirst().content();
            assertTrue(prompt.contains("not only in sharedScenario or advice"));
            assertTrue(prompt.contains("two or three concise sentences with tangible actions"));
            assertTrue(prompt.contains("each option has its own arriveHome fact"));
            assertTrue(prompt.contains("not something happening every day"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-side", "blank", "number", "unknown-fact", "numeric-claim", "calendar-payback"})
    void rejectsIncompleteOrUnsupportedAdviceWithTheSameBoundedRepair(String defect) throws Exception {
        ObjectNode draft = draft("break-even");
        ObjectNode option = (ObjectNode) draft.path("optionA");
        switch (defect) {
            case "missing-side" -> option.remove("advice");
            case "blank" -> option.put("advice", " ");
            case "number" -> option.put("advice", 5);
            case "unknown-fact" -> option.put("advice", "Save {{inventedSavings}} for the next purchase.");
            case "numeric-claim" -> option.put("advice", "Set aside $50 for the next purchase.");
            case "calendar-payback" -> option.put("advice", "Work out how many months of cups would cover the upfront cost.");
            default -> throw new IllegalArgumentException(defect);
        }
        model.reply(draft, draft);
        ApiException exception = assertThrows(ApiException.class, () -> service.story(request("break-even")));
        assertEquals("MODEL_OUTPUT_INVALID", exception.code());
        assertEquals(2, model.requests.size());
    }

    @Test
    void preservesLoadedLegacyStoriesAndRejectsWrongAdviceIdentity() throws Exception {
        ObjectNode request = request("qualitative");
        ObjectNode legacy = (ObjectNode) new StoryDraftAssembler(mapper, contract).assemble(draft("qualitative"), request);
        ((ObjectNode) legacy.path("advice").get(0)).put("optionId", "unrelated-option");
        assertThrows(ContractValidator.ContractException.class, () -> validator.response(legacy, request));
        legacy.remove("advice");
        validator.response(legacy, request);
    }

    private ObjectNode request(String mode) throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-" + mode + "-request.json")) { return (ObjectNode) mapper.readTree(stream); }
    }

    private ObjectNode draft(String mode) {
        ObjectNode draft = mapper.createObjectNode();
        draft.putObject("sharedScenario").put("title", "A possible shared situation")
                .put("description", "Imagine the selected circumstances shaping either path; this is an illustrative possibility.");
        String[] moments = mode.equals("general") ? new String[]{"morning", "daytime", "evening"} : new String[]{"beginning", "during", "later"};
        for (String key : List.of("optionA", "optionB")) {
            ObjectNode option = draft.putObject(key);
            option.put(moments[0], "In this possible scene, you begin using {{" + key + "_name}} within the selected routine.");
            option.put(moments[1], "If the selected needs shift, you adjust the routine around the same situation.");
            option.put(moments[2], "You carry that practical adjustment into your next use of this path.");
            option.put("advice", "Before choosing {{" + key + "_name}}, write down the selected need and prepare an action that would make the arrangement fit it.");
        }
        return draft;
    }

    private final class RecordingModel implements ModelClient {
        final ArrayDeque<String> responses = new ArrayDeque<>();
        final List<List<Message>> requests = new ArrayList<>();
        void reply(JsonNode... replies) throws IOException { for (JsonNode reply : replies) responses.add(mapper.writeValueAsString(reply)); }
        @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return responses.remove(); }
        @Override public boolean configured() { return true; }
    }
}
