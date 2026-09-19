package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class SimulationReconciler {
    private static final BigInteger MAX = BigInteger.valueOf(9_007_199_254_740_991L);
    private final ContractValidator contract;
    private final ObjectMapper mapper;

    public SimulationReconciler(ContractValidator contract, ObjectMapper mapper) {
        this.contract = contract;
        this.mapper = mapper;
    }

    public void reconcile(JsonNode snapshot) {
        JsonNode decision = snapshot.path("decision");
        JsonNode submitted = snapshot.path("calculation");
        Set<String> enabledIds = new HashSet<>();
        snapshot.path("enabledTagIds").forEach(id -> enabledIds.add(id.asText()));
        List<JsonNode> enabledTags = new ArrayList<>();
        decision.path("tags").forEach(tag -> {
            if (enabledIds.contains(tag.path("id").asText())) enabledTags.add(tag);
        });
        enabledTags.sort(Comparator.comparing(tag -> tag.path("id").asText()));

        long[] cost = new long[2];
        long[] minutes = new long[2];
        for (int optionIndex = 0; optionIndex < 2; optionIndex++) {
            JsonNode option = decision.path("options").get(optionIndex);
            String optionId = option.path("id").asText();
            String path = "snapshot.calculation.options[" + optionIndex + "]";
            ArrayNode expected = mapper.createArrayNode();
            for (JsonNode fixed : option.path("fixedCosts")) {
                ObjectNode item = item(optionId + ":" + fixed.path("id").asText() + ":fixed",
                        "baseline_fixed", fixed.path("name").asText());
                item.put("totalCostCents", value(fixed.path("amountCentsMonthly"), path + ".fixedCosts"));
                item.put("totalTimeMinutes", 0);
                expected.add(item);
            }
            for (JsonNode activity : option.path("activities")) {
                String activityId = activity.path("id").asText();
                String activityPath = path + ".activities." + activityId;
                BigInteger available = BigInteger.valueOf(value(activity.path("eventsPerMonth"), activityPath + ".eventsPerMonth"));
                List<Replacement> replacements = new ArrayList<>();
                for (JsonNode tag : enabledTags) {
                    String type = tag.path("type").asText();
                    if (type.equals("fixed")) continue;
                    for (JsonNode target : tag.path("targets")) {
                        if (!optionId.equals(target.path("optionId").asText())
                                || !activityId.equals(target.path("activityId").asText())) continue;
                        long events = value(target.path("eventsPerMonth"), activityPath + ".tags." + tag.path("id").asText());
                        if (type.equals("add_activity")) available = available.add(BigInteger.valueOf(events));
                        else if (type.equals("reduce_activity")) available = available.subtract(BigInteger.valueOf(events));
                        else if (type.equals("replace_activity")) replacements.add(new Replacement(tag, target, events));
                    }
                }
                if (available.signum() < 0) ContractValidator.fail(activityPath, "Activity count becomes negative.");
                long availableEvents = checked(available, activityPath + ".available");
                BigInteger replaced = replacements.stream().map(item -> BigInteger.valueOf(item.events))
                        .reduce(BigInteger.ZERO, BigInteger::add);
                if (replaced.compareTo(available) > 0) ContractValidator.fail(activityPath, "Replacement events exceed available events.");
                long originalEvents = checked(available.subtract(replaced), activityPath + ".originalEvents");
                long originalCost = value(activity.path("costCentsPerEvent"), activityPath + ".costCentsPerEvent");
                long originalMinutes = value(activity.path("minutesPerEvent"), activityPath + ".minutesPerEvent");
                ObjectNode original = item(optionId + ":" + activityId + ":original",
                        "original_activity", activity.path("name").asText());
                original.put("activityId", activityId);
                original.put("eventsPerMonth", originalEvents);
                original.put("costCentsPerEvent", originalCost);
                original.put("minutesPerEvent", originalMinutes);
                original.put("totalCostCents", product(originalEvents, originalCost, activityPath + ".originalCost"));
                original.put("totalTimeMinutes", product(originalEvents, originalMinutes, activityPath + ".originalTime"));
                expected.add(original);
                for (Replacement replacement : replacements) {
                    String tagId = replacement.tag.path("id").asText();
                    JsonNode target = replacement.target;
                    long replacementCost = value(target.path("costCentsPerEvent"), activityPath + ".tags." + tagId + ".cost");
                    long replacementMinutes = value(target.path("minutesPerEvent"), activityPath + ".tags." + tagId + ".time");
                    ObjectNode item = item(optionId + ":" + activityId + ":" + tagId + ":replacement",
                            "replacement_activity", target.path("replacementName").asText());
                    item.put("activityId", activityId);
                    item.put("tagId", tagId);
                    item.put("eventsPerMonth", replacement.events);
                    item.put("costCentsPerEvent", replacementCost);
                    item.put("minutesPerEvent", replacementMinutes);
                    item.put("totalCostCents", product(replacement.events, replacementCost, activityPath + ".tags." + tagId + ".totalCost"));
                    item.put("totalTimeMinutes", product(replacement.events, replacementMinutes, activityPath + ".tags." + tagId + ".totalTime"));
                    expected.add(item);
                }
            }
            for (JsonNode tag : enabledTags) {
                if (!"fixed".equals(tag.path("type").asText())) continue;
                for (JsonNode target : tag.path("targets")) {
                    if (!optionId.equals(target.path("optionId").asText())) continue;
                    String tagId = tag.path("id").asText();
                    ObjectNode item = item(optionId + ":" + tagId + ":fixed", "tag_fixed", tag.path("name").asText());
                    item.put("tagId", tagId);
                    item.put("totalCostCents", value(target.path("costCentsMonthly"), path + ".tags." + tagId + ".cost"));
                    item.put("totalTimeMinutes", value(target.path("minutesMonthly"), path + ".tags." + tagId + ".time"));
                    expected.add(item);
                }
            }
            JsonNode actual = submitted.path("options").get(optionIndex);
            contract.array(actual.path("breakdown"), path + ".breakdown", 0, 500);
            if (!sameItems(expected, actual.path("breakdown"))) {
                ContractValidator.fail(path + ".breakdown", "Breakdown does not match the decision and enabled Tags.");
            }
            BigInteger totalCost = BigInteger.ZERO;
            BigInteger totalTime = BigInteger.ZERO;
            for (JsonNode item : expected) {
                totalCost = totalCost.add(BigInteger.valueOf(item.path("totalCostCents").longValue()));
                totalTime = totalTime.add(BigInteger.valueOf(item.path("totalTimeMinutes").longValue()));
            }
            cost[optionIndex] = checked(totalCost, path + ".totalCostCents");
            minutes[optionIndex] = checked(totalTime, path + ".totalTimeMinutes");
            if (contract.integer(actual.path("totalCostCents"), path + ".totalCostCents") != cost[optionIndex]
                    || contract.integer(actual.path("totalTimeMinutes"), path + ".totalTimeMinutes") != minutes[optionIndex]) {
                ContractValidator.fail(path, "Totals do not match the decision and enabled Tags.");
            }
        }
        JsonNode comparison = submitted.path("comparison");
        long costDelta = signed(BigInteger.valueOf(cost[1]).subtract(BigInteger.valueOf(cost[0])), "snapshot.calculation.comparison.costDeltaCents");
        long timeDelta = signed(BigInteger.valueOf(minutes[1]).subtract(BigInteger.valueOf(minutes[0])), "snapshot.calculation.comparison.timeDeltaMinutes");
        if (comparison.path("costDeltaCents").longValue() != costDelta
                || comparison.path("timeDeltaMinutes").longValue() != timeDelta) {
            ContractValidator.fail("snapshot.calculation.comparison", "Comparison does not match the decision and enabled Tags.");
        }
    }

    private ObjectNode item(String id, String kind, String label) {
        ObjectNode item = mapper.createObjectNode();
        item.put("id", id);
        item.put("kind", kind);
        item.put("label", label);
        return item;
    }

    private long value(JsonNode field, String path) {
        String source = field.path("source").asText();
        if (source.equals("unknown") || (source.equals("demo_assumption") && !field.path("confirmed").asBoolean())) {
            ContractValidator.fail(path, "Stories require complete, confirmed simulation values.");
        }
        return contract.integer(field.path("value"), path + ".value");
    }

    private long product(long left, long right, String path) {
        return checked(BigInteger.valueOf(left).multiply(BigInteger.valueOf(right)), path);
    }

    private long checked(BigInteger value, String path) {
        if (value.signum() < 0 || value.compareTo(MAX) > 0) ContractValidator.fail(path, "Result exceeds the safe integer range.");
        return value.longValue();
    }

    private long signed(BigInteger value, String path) {
        if (value.abs().compareTo(MAX) > 0) ContractValidator.fail(path, "Difference exceeds the safe integer range.");
        return value.longValue();
    }

    private boolean sameItems(JsonNode expected, JsonNode actual) {
        if (expected.size() != actual.size()) return false;
        List<JsonNode> remaining = new ArrayList<>();
        actual.forEach(remaining::add);
        for (JsonNode item : expected) {
            int match = -1;
            for (int i = 0; i < remaining.size(); i++) {
                if (sameNode(item, remaining.get(i))) { match = i; break; }
            }
            if (match < 0) return false;
            remaining.remove(match);
        }
        return remaining.isEmpty();
    }

    private boolean sameNode(JsonNode expected, JsonNode actual) {
        if (expected.isIntegralNumber() && actual.isIntegralNumber()) return expected.longValue() == actual.longValue();
        if (expected.isObject() && actual.isObject()) {
            if (expected.size() != actual.size()) return false;
            var fields = expected.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                if (!actual.has(field.getKey()) || !sameNode(field.getValue(), actual.get(field.getKey()))) return false;
            }
            return true;
        }
        return expected.equals(actual);
    }

    private record Replacement(JsonNode tag, JsonNode target, long events) {}
}
