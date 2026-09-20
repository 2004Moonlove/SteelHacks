package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Binds generated narrative text to the validated request's identity and option order. */
public final class StoryDraftAssembler {
    private static final String[] MOMENTS = {"morning", "daytime", "evening"};
    private static final String[] OPTION_KEYS = {"optionA", "optionB"};
    private final ObjectMapper mapper;
    private final ContractValidator contract;

    public StoryDraftAssembler(ObjectMapper mapper, ContractValidator contract) {
        this.mapper = mapper;
        this.contract = contract;
    }

    public JsonNode assemble(JsonNode draft, JsonNode request) {
        contract.object(draft, "storyDraft");
        if (draft.has("decisionId") || draft.has("simulationVersion")
                || draft.has("moments") || draft.has("monthlyReflections")) {
            // Legacy responses retain their metadata and must pass the existing response validator.
            return draft;
        }
        contract.onlyFields(draft, "storyDraft", "sharedScenario", "optionA", "optionB");
        JsonNode shared = contract.object(draft.path("sharedScenario"), "storyDraft.sharedScenario");
        contract.onlyFields(shared, "storyDraft.sharedScenario", "title", "description");
        contract.string(shared.path("title"), "storyDraft.sharedScenario.title");
        contract.string(shared.path("description"), "storyDraft.sharedScenario.description");
        for (String optionKey : OPTION_KEYS) {
            String path = "storyDraft." + optionKey;
            JsonNode option = contract.object(draft.path(optionKey), path);
            contract.onlyFields(option, path, "morning", "daytime", "evening");
            for (String moment : MOMENTS) contract.string(option.path(moment), path + "." + moment);
        }

        JsonNode snapshot = request.path("snapshot");
        JsonNode options = snapshot.path("decision").path("options");
        ObjectNode story = mapper.createObjectNode();
        story.set("decisionId", snapshot.path("decision").path("id").deepCopy());
        story.set("simulationVersion", snapshot.path("simulationVersion").deepCopy());
        story.set("sharedScenario", shared.deepCopy());
        ArrayNode moments = story.putArray("moments");
        for (String key : MOMENTS) {
            ObjectNode moment = moments.addObject().put("key", key);
            ArrayNode entries = moment.putArray("options");
            for (int i = 0; i < OPTION_KEYS.length; i++) {
                entries.addObject().put("optionId", options.get(i).path("id").asText())
                        .put("text", draft.path(OPTION_KEYS[i]).path(key).asText());
            }
        }
        ArrayNode reflections = story.putArray("monthlyReflections");
        for (int i = 0; i < OPTION_KEYS.length; i++) {
            reflections.addObject().put("optionId", options.get(i).path("id").asText())
                    .put("text", "{{" + OPTION_KEYS[i] + "_name}} has a monthly cost of {{"
                            + OPTION_KEYS[i] + "_monthlyCost}} and uses {{" + OPTION_KEYS[i]
                            + "_monthlyTime}} of tracked time.");
        }
        return story;
    }
}
