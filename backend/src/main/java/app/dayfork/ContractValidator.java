package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Arrays;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class ContractValidator {
    static final int MAX_TEXT_LENGTH = 5000;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,80}");

    public void decision(JsonNode decision) {
        object(decision, "decision");
        onlyFields(decision, "decision", "schemaVersion", "id", "title", "description", "originalInput", "currency", "options", "tags");
        if (integer(decision.path("schemaVersion"), "decision.schemaVersion") != 1) {
            fail("decision.schemaVersion", "Schema version must be 1.");
        }
        id(decision.path("id"), "decision.id");
        string(decision.path("title"), "decision.title");
        string(decision.path("description"), "decision.description");
        string(decision.path("originalInput"), "decision.originalInput");
        if (!"USD".equals(string(decision.path("currency"), "decision.currency"))) {
            fail("decision.currency", "Only USD is supported.");
        }
        JsonNode options = array(decision.path("options"), "decision.options", 2, 2);
        Set<String> optionIds = new HashSet<>();
        for (int i = 0; i < options.size(); i++) {
            JsonNode option = object(options.get(i), "decision.options[" + i + "]");
            String path = "decision.options[" + i + "]";
            onlyFields(option, path, "id", "name", "fixedCosts", "activities");
            String optionId = id(option.path("id"), path + ".id");
            unique(optionIds, optionId, path + ".id");
            string(option.path("name"), path + ".name");
            JsonNode fixedCosts = array(option.path("fixedCosts"), path + ".fixedCosts", 0, 100);
            Set<String> fixedIds = new HashSet<>();
            for (int j = 0; j < fixedCosts.size(); j++) {
                String fixedPath = path + ".fixedCosts[" + j + "]";
                JsonNode fixed = object(fixedCosts.get(j), fixedPath);
                onlyFields(fixed, fixedPath, "id", "name", "amountCentsMonthly");
                unique(fixedIds, id(fixed.path("id"), fixedPath + ".id"), fixedPath + ".id");
                string(fixed.path("name"), fixedPath + ".name");
                numeric(fixed.path("amountCentsMonthly"), fixedPath + ".amountCentsMonthly");
            }
            JsonNode activities = array(option.path("activities"), path + ".activities", 0, 100);
            Set<String> activityIds = new HashSet<>();
            for (int j = 0; j < activities.size(); j++) {
                String activityPath = path + ".activities[" + j + "]";
                JsonNode activity = object(activities.get(j), activityPath);
                onlyFields(activity, activityPath, "id", "name", "eventUnit", "frequencyInput", "eventsPerMonth", "costCentsPerEvent", "minutesPerEvent");
                unique(activityIds, id(activity.path("id"), activityPath + ".id"), activityPath + ".id");
                string(activity.path("name"), activityPath + ".name");
                oneOf(activity.path("eventUnit"), activityPath + ".eventUnit",
                        "one_way_trip", "meal", "session", "event");
                if (activity.has("frequencyInput")) {
                    JsonNode frequency = object(activity.path("frequencyInput"), activityPath + ".frequencyInput");
                    onlyFields(frequency, activityPath + ".frequencyInput", "label", "eventsPerUnit");
                    string(frequency.path("label"), activityPath + ".frequencyInput.label");
                    if (!frequency.path("eventsPerUnit").isIntegralNumber()) {
                        fail(activityPath + ".frequencyInput.eventsPerUnit",
                                "Use a plain positive integer conversion factor, such as 2 for two one-way trips per round trip. "
                                + "This is not a NumericField or the monthly usage. Omit frequencyInput when no conversion is needed.");
                    }
                    if (integer(frequency.path("eventsPerUnit"), activityPath + ".frequencyInput.eventsPerUnit") < 1) {
                        fail(activityPath + ".frequencyInput.eventsPerUnit", "Conversion must be positive.");
                    }
                }
                numeric(activity.path("eventsPerMonth"), activityPath + ".eventsPerMonth");
                numeric(activity.path("costCentsPerEvent"), activityPath + ".costCentsPerEvent");
                numeric(activity.path("minutesPerEvent"), activityPath + ".minutesPerEvent");
            }
        }
        JsonNode tags = array(decision.path("tags"), "decision.tags", 0, 100);
        Set<String> tagIds = new HashSet<>();
        for (int i = 0; i < tags.size(); i++) {
            String path = "decision.tags[" + i + "]";
            JsonNode tag = object(tags.get(i), path);
            onlyFields(tag, path, "id", "name", "icon", "description", "type", "targets");
            unique(tagIds, id(tag.path("id"), path + ".id"), path + ".id");
            string(tag.path("name"), path + ".name");
            string(tag.path("description"), path + ".description");
            if (tag.has("icon")) string(tag.path("icon"), path + ".icon");
            String type = oneOf(tag.path("type"), path + ".type", "fixed", "add_activity",
                    "reduce_activity", "replace_activity");
            JsonNode targets = array(tag.path("targets"), path + ".targets", 1, 100);
            Set<String> targetKeys = new HashSet<>();
            for (int j = 0; j < targets.size(); j++) {
                String targetPath = path + ".targets[" + j + "]";
                JsonNode target = object(targets.get(j), targetPath);
                if (type.equals("fixed")) onlyFields(target, targetPath, "optionId", "costCentsMonthly", "minutesMonthly");
                else if (type.equals("replace_activity")) onlyFields(target, targetPath, "optionId", "activityId", "replacementName", "eventsPerMonth", "costCentsPerEvent", "minutesPerEvent");
                else onlyFields(target, targetPath, "optionId", "activityId", "eventsPerMonth");
                String optionId = id(target.path("optionId"), targetPath + ".optionId");
                if (!optionIds.contains(optionId)) fail(targetPath + ".optionId", "Unknown option reference.");
                String targetKey = optionId;
                if (!type.equals("fixed")) {
                    String activityId = id(target.path("activityId"), targetPath + ".activityId");
                    if (!activityExists(options, optionId, activityId)) {
                        fail(targetPath + ".activityId", "Unknown activity reference.");
                    }
                    targetKey += "/" + activityId;
                    numeric(target.path("eventsPerMonth"), targetPath + ".eventsPerMonth");
                } else {
                    numeric(target.path("costCentsMonthly"), targetPath + ".costCentsMonthly");
                    numeric(target.path("minutesMonthly"), targetPath + ".minutesMonthly");
                }
                if (type.equals("replace_activity")) {
                    string(target.path("replacementName"), targetPath + ".replacementName");
                    numeric(target.path("costCentsPerEvent"), targetPath + ".costCentsPerEvent");
                    numeric(target.path("minutesPerEvent"), targetPath + ".minutesPerEvent");
                }
                unique(targetKeys, targetKey, targetPath);
            }
        }
    }

    public void generatedDecision(JsonNode decision) {
        decision(decision);
        int count = decision.path("tags").size();
        if (count < 5 || count > 10) fail("decision.tags", "Generated decisions require 5 to 10 Tags.");
        generatedSources(decision, "decision");
    }

    private void generatedSources(JsonNode node, String path) {
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) generatedSources(node.get(i), path + "[" + i + "]");
        } else if (node.isObject()) {
            if (node.has("source")) {
                oneOf(node.path("source"), path + ".source", "user_input", "derived", "unknown");
            }
            node.fields().forEachRemaining(entry -> generatedSources(entry.getValue(), path + "." + entry.getKey()));
        }
    }

    private boolean activityExists(JsonNode options, String optionId, String activityId) {
        for (JsonNode option : options) {
            if (option.path("id").asText().equals(optionId)) {
                for (JsonNode activity : option.path("activities")) {
                    if (activity.path("id").asText().equals(activityId)) return true;
                }
            }
        }
        return false;
    }

    public void numeric(JsonNode field, String path) {
        object(field, path);
        onlyFields(field, path, "value", "source", "confirmed", "note");
        String source = oneOf(field.path("source"), path + ".source", "user_input", "user_edit",
                "derived", "demo_assumption", "unknown");
        JsonNode value = field.path("value");
        if (source.equals("unknown")) {
            if (!value.isNull()) fail(path + ".value", "Unknown values must be null.");
        } else {
            integer(value, path + ".value");
        }
        if (source.equals("demo_assumption")) {
            if (!field.path("confirmed").isBoolean()) fail(path + ".confirmed", "Confirmation must be boolean.");
            string(field.path("note"), path + ".note");
        } else if (field.has("confirmed")) {
            fail(path + ".confirmed", "Only demo assumptions can be confirmed.");
        }
        if (field.has("note") && !source.equals("demo_assumption")) string(field.path("note"), path + ".note");
    }

    public long integer(JsonNode node, String path) {
        if (!node.isIntegralNumber() || !node.canConvertToLong()) fail(path, "Value must be a safe integer.");
        long value = node.longValue();
        if (value < 0 || value > MAX_SAFE_INTEGER) fail(path, "Value must be a nonnegative safe integer.");
        return value;
    }

    public String id(JsonNode node, String path) {
        String value = string(node, path);
        if (!ID.matcher(value).matches()) fail(path, "ID must contain only letters, numbers, underscores, or hyphens.");
        return value;
    }

    public String string(JsonNode node, String path) {
        if (!node.isTextual() || node.asText().isBlank() || node.asText().length() > MAX_TEXT_LENGTH) {
            fail(path, "A nonempty string is required.");
        }
        return node.asText();
    }

    public String oneOf(JsonNode node, String path, String... choices) {
        String value = string(node, path);
        for (String choice : choices) if (choice.equals(value)) return value;
        fail(path, "Expected one of: " + String.join(", ", choices) + ".");
        return value;
    }

    public JsonNode object(JsonNode node, String path) {
        if (!node.isObject()) fail(path, "An object is required.");
        return node;
    }

    public JsonNode array(JsonNode node, String path, int minimum, int maximum) {
        if (!node.isArray() || node.size() < minimum || node.size() > maximum) {
            fail(path, "Array length must be between " + minimum + " and " + maximum + ".");
        }
        return node;
    }

    public void onlyFields(JsonNode node, String path, String... allowed) {
        Set<String> permitted = new HashSet<>(Arrays.asList(allowed));
        node.fieldNames().forEachRemaining(field -> {
            if (!permitted.contains(field)) fail(path + "." + field, "Unexpected field.");
        });
    }

    private void unique(Set<String> seen, String value, String path) {
        if (!seen.add(value)) fail(path, "Duplicate ID or target.");
    }

    public static void fail(String path, String message) {
        throw new ContractException(path, message);
    }

    public static class ContractException extends RuntimeException {
        private final String path;
        public ContractException(String path, String message) { super(message); this.path = path; }
        public String path() { return path; }
    }
}
