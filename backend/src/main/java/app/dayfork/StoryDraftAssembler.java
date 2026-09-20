package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Binds generated narrative text to the validated request's identity and option order. */
public final class StoryDraftAssembler {
    private static final String[] DAILY_MOMENTS = {"morning", "daytime", "evening"};
    private static final String[] LONG_TERM_MOMENTS = {"beginning", "during", "later"};
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
            return finish(draft, request);
        }
        boolean qualitative = ContractValidator.isLongTerm(request.path("snapshot").path("decision"));
        String[] momentKeys = qualitative ? LONG_TERM_MOMENTS : DAILY_MOMENTS;
        contract.onlyFields(draft, "storyDraft", "sharedScenario", "optionA", "optionB");
        JsonNode shared = contract.object(draft.path("sharedScenario"), "storyDraft.sharedScenario");
        contract.onlyFields(shared, "storyDraft.sharedScenario", "title", "description");
        contract.string(shared.path("title"), "storyDraft.sharedScenario.title");
        contract.string(shared.path("description"), "storyDraft.sharedScenario.description");
        boolean hasAdvice = draft.path("optionA").has("advice") || draft.path("optionB").has("advice");
        for (String optionKey : OPTION_KEYS) {
            String path = "storyDraft." + optionKey;
            JsonNode option = contract.object(draft.path(optionKey), path);
            String[] allowed = java.util.Arrays.copyOf(momentKeys, momentKeys.length + 1);
            allowed[allowed.length - 1] = "advice";
            contract.onlyFields(option, path, allowed);
            for (String moment : momentKeys) contract.string(option.path(moment), path + "." + moment);
            if (hasAdvice) contract.string(option.path("advice"), path + ".advice");
        }

        JsonNode snapshot = request.path("snapshot");
        JsonNode options = snapshot.path("decision").path("options");
        ObjectNode story = mapper.createObjectNode();
        if (qualitative) story.put("mode", "qualitative");
        story.set("decisionId", snapshot.path("decision").path("id").deepCopy());
        story.set("simulationVersion", snapshot.path("simulationVersion").deepCopy());
        story.set("sharedScenario", shared.deepCopy());
        ArrayNode moments = story.putArray("moments");
        for (String key : momentKeys) {
            ObjectNode moment = moments.addObject().put("key", key);
            ArrayNode entries = moment.putArray("options");
            for (int i = 0; i < OPTION_KEYS.length; i++) {
                entries.addObject().put("optionId", options.get(i).path("id").asText())
                        .put("text", draft.path(OPTION_KEYS[i]).path(key).asText());
            }
        }
        if (hasAdvice) {
            ArrayNode advice = story.putArray("advice");
            for (int i = 0; i < OPTION_KEYS.length; i++) {
                advice.addObject().put("optionId", options.get(i).path("id").asText())
                        .put("text", draft.path(OPTION_KEYS[i]).path("advice").asText());
            }
        }
        ArrayNode reflections = story.putArray("monthlyReflections");
        if (qualitative) return finish(story, request);
        for (int i = 0; i < OPTION_KEYS.length; i++) {
            reflections.addObject().put("optionId", options.get(i).path("id").asText())
                    .put("text", "{{" + OPTION_KEYS[i] + "_name}} has a monthly cost of {{"
                            + OPTION_KEYS[i] + "_monthlyCost}} and uses {{" + OPTION_KEYS[i]
                            + "_monthlyTime}} of tracked time.");
        }
        return finish(story, request);
    }

    private JsonNode finish(JsonNode story, JsonNode request) {
        return StoryMoneyNormalizer.normalize(ensureCostSummary(story, request), request.path("facts"));
    }

    private JsonNode ensureCostSummary(JsonNode story, JsonNode request) {
        JsonNode decision = request.path("snapshot").path("decision");
        String summary = ContractValidator.isBreakEven(decision) ? "{{breakEvenSummary}}"
                : ContractValidator.isSubscription(decision) ? "{{subscriptionCostComparison}}" : null;
        if (summary == null || story.toString().contains(summary)) return story;
        JsonNode shared = story.path("sharedScenario");
        if (!shared.isObject() || !shared.path("description").isTextual()) return story;
        // Insert the reconciled fact, never a model-computed threshold. Preserve supplied metadata for validation.
        ObjectNode result = story.deepCopy();
        ((ObjectNode) result.path("sharedScenario")).put("description",
                shared.path("description").asText() + " " + summary);
        return result;
    }
}
