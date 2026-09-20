package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
import java.util.Set;

/** Projects a validated snapshot into the facts and configured routines needed for narrative text. */
final class StoryModelInput {
    private final ObjectMapper mapper;

    StoryModelInput(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    ObjectNode project(JsonNode request) {
        JsonNode snapshot = request.path("snapshot");
        JsonNode decision = snapshot.path("decision");
        Set<String> enabled = new HashSet<>();
        snapshot.path("enabledTagIds").forEach(id -> enabled.add(id.asText()));
        ObjectNode input = mapper.createObjectNode();
        input.putObject("context").put("mode", request.path("context").path("mode").asText());
        input.set("facts", request.path("facts").deepCopy());
        for (int i = 0; i < 2; i++) {
            String key = i == 0 ? "optionA" : "optionB";
            JsonNode option = decision.path("options").get(i);
            String optionId = option.path("id").asText();
            ObjectNode projected = input.putObject(key).put("nameFact", "{{" + key + "_name}}");
            var recurring = projected.putArray("recurringItems");
            var activities = projected.putArray("activities");
            for (JsonNode item : snapshot.path("calculation").path("options").get(i).path("breakdown")) {
                String kind = item.path("kind").asText();
                if (kind.equals("baseline_fixed") || kind.equals("tag_fixed")) {
                    recurring.addObject().put("label", item.path("label").asText()).put("kind", kind)
                            .put("hasMonthlyCost", item.path("totalCostCents").longValue() > 0)
                            .put("hasTrackedTime", item.path("totalTimeMinutes").longValue() > 0);
                } else {
                    activities.addObject().put("label", item.path("label").asText()).put("kind", kind)
                            .put("eventUnit", activityUnit(option, item.path("activityId").asText()))
                            .put("hasMonthlyEvents", item.path("eventsPerMonth").longValue() > 0);
                }
            }
            var adjustments = projected.putArray("enabledAdjustments");
            for (JsonNode tag : decision.path("tags")) {
                if (!enabled.contains(tag.path("id").asText())) continue;
                for (JsonNode target : tag.path("targets")) {
                    if (optionId.equals(target.path("optionId").asText())) {
                        adjustments.addObject().put("name", tag.path("name").asText()).put("type", tag.path("type").asText());
                        break;
                    }
                }
            }
        }
        return input;
    }

    private String activityUnit(JsonNode option, String activityId) {
        for (JsonNode activity : option.path("activities")) {
            if (activityId.equals(activity.path("id").asText())) return activity.path("eventUnit").asText();
        }
        throw new IllegalStateException("A reconciled story activity must belong to its option.");
    }
}
