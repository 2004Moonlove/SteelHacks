package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class StoryValidator {
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{([A-Za-z0-9_-]{1,80})}}", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUMBER = Pattern.compile("[0-9]");
    private final ContractValidator contract;
    private final SimulationReconciler reconciler;

    public StoryValidator(ContractValidator contract, SimulationReconciler reconciler) {
        this.contract = contract;
        this.reconciler = reconciler;
    }

    public void request(JsonNode request) {
        contract.object(request, "request");
        JsonNode snapshot = contract.object(request.path("snapshot"), "snapshot");
        JsonNode decision = snapshot.path("decision");
        contract.decision(decision);
        contract.integer(snapshot.path("simulationVersion"), "snapshot.simulationVersion");
        JsonNode enabled = contract.array(snapshot.path("enabledTagIds"), "snapshot.enabledTagIds", 0, 100);
        Set<String> knownTags = new HashSet<>();
        decision.path("tags").forEach(tag -> knownTags.add(tag.path("id").asText()));
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < enabled.size(); i++) {
            String id = contract.id(enabled.get(i), "snapshot.enabledTagIds[" + i + "]");
            if (!knownTags.contains(id) || !seen.add(id)) {
                ContractValidator.fail("snapshot.enabledTagIds[" + i + "]", "Unknown or duplicate Tag ID.");
            }
        }
        JsonNode calculation = contract.object(snapshot.path("calculation"), "snapshot.calculation");
        if (!"valid".equals(contract.string(calculation.path("status"), "snapshot.calculation.status"))) {
            ContractValidator.fail("snapshot.calculation.status", "Stories require valid calculation results.");
        }
        JsonNode results = contract.array(calculation.path("options"), "snapshot.calculation.options", 2, 2);
        long[] cost = new long[2];
        long[] time = new long[2];
        for (int i = 0; i < 2; i++) {
            String expected = decision.path("options").get(i).path("id").asText();
            JsonNode result = contract.object(results.get(i), "snapshot.calculation.options[" + i + "]");
            if (!expected.equals(contract.id(result.path("optionId"), "snapshot.calculation.options[" + i + "].optionId"))) {
                ContractValidator.fail("snapshot.calculation.options[" + i + "].optionId", "Result option does not match decision.");
            }
            cost[i] = contract.integer(result.path("totalCostCents"), "snapshot.calculation.options[" + i + "].totalCostCents");
            time[i] = contract.integer(result.path("totalTimeMinutes"), "snapshot.calculation.options[" + i + "].totalTimeMinutes");
            JsonNode breakdown = contract.array(result.path("breakdown"), "snapshot.calculation.options[" + i + "].breakdown", 0, 500);
            long costSum = 0;
            long timeSum = 0;
            for (int j = 0; j < breakdown.size(); j++) {
                JsonNode item = contract.object(breakdown.get(j), "snapshot.calculation.options[" + i + "].breakdown[" + j + "]");
                costSum = safeAdd(costSum, contract.integer(item.path("totalCostCents"), "breakdown.totalCostCents"));
                timeSum = safeAdd(timeSum, contract.integer(item.path("totalTimeMinutes"), "breakdown.totalTimeMinutes"));
            }
            if (costSum != cost[i] || timeSum != time[i]) {
                ContractValidator.fail("snapshot.calculation.options[" + i + "].breakdown", "Breakdown does not match totals.");
            }
        }
        JsonNode comparison = contract.object(calculation.path("comparison"), "snapshot.calculation.comparison");
        if (signedInteger(comparison.path("costDeltaCents"), "snapshot.calculation.comparison.costDeltaCents") != cost[1] - cost[0]
                || signedInteger(comparison.path("timeDeltaMinutes"), "snapshot.calculation.comparison.timeDeltaMinutes") != time[1] - time[0]) {
            ContractValidator.fail("snapshot.calculation.comparison", "Comparison does not match option totals.");
        }
        reconciler.reconcile(snapshot);
        JsonNode facts = contract.object(request.path("facts"), "facts");
        JsonNode context = contract.object(request.path("context"), "context");
        String mode = contract.oneOf(context.path("mode"), "context.mode", "general", "campus");
        if (mode.equals("campus")) {
            time(context.path("arrivalTime"), "context.arrivalTime");
            time(context.path("departureTime"), "context.departureTime");
            int arrivalMinutes = timeMinutes(context.path("arrivalTime").asText());
            int departureMinutes = timeMinutes(context.path("departureTime").asText());
            if (departureMinutes <= arrivalMinutes) ContractValidator.fail("context.departureTime", "Departure must follow arrival on the same day.");
            JsonNode selections = contract.array(context.path("selections"), "context.selections", 2, 2);
            for (int i = 0; i < 2; i++) {
                JsonNode selection = contract.object(selections.get(i), "context.selections[" + i + "]");
                String expectedOptionId = decision.path("options").get(i).path("id").asText();
                String optionId = contract.id(selection.path("optionId"), "context.selections[" + i + "].optionId");
                if (!expectedOptionId.equals(optionId)) ContractValidator.fail("context.selections[" + i + "].optionId", "Selection option does not match decision.");
                String activityId = contract.id(selection.path("activityId"), "context.selections[" + i + "].activityId");
                boolean validActivity = false;
                for (JsonNode activity : decision.path("options").get(i).path("activities")) {
                    if (activityId.equals(activity.path("id").asText()) && "one_way_trip".equals(activity.path("eventUnit").asText())) validActivity = true;
                }
                if (!validActivity) ContractValidator.fail("context.selections[" + i + "].activityId", "Campus stories require a one-way trip activity.");
                String outboundId = contract.string(selection.path("outboundChoiceId"), "context.selections[" + i + "].outboundChoiceId");
                String inboundId = contract.string(selection.path("inboundChoiceId"), "context.selections[" + i + "].inboundChoiceId");
                JsonNode breakdown = results.get(i).path("breakdown");
                Choice outbound = choice(breakdown, activityId, outboundId, "context.selections[" + i + "].outboundChoiceId");
                Choice inbound = choice(breakdown, activityId, inboundId, "context.selections[" + i + "].inboundChoiceId");
                if (outboundId.equals(inboundId) && outbound.events < 2) {
                    ContractValidator.fail("context.selections[" + i + "]", "The selected travel mode needs two monthly events.");
                }
                String prefix = i == 0 ? "optionA" : "optionB";
                JsonNode campusFacts = request.path("facts");
                expectedFact(campusFacts, prefix + "_leaveHome", clockTime(arrivalMinutes - outbound.minutes));
                expectedFact(campusFacts, prefix + "_arriveCampus", clockTime(arrivalMinutes));
                expectedFact(campusFacts, prefix + "_leaveCampus", clockTime(departureMinutes));
                expectedFact(campusFacts, prefix + "_arriveHome", clockTime(departureMinutes + inbound.minutes));
                expectedFact(campusFacts, prefix + "_outboundMode", outbound.label);
                expectedFact(campusFacts, prefix + "_inboundMode", inbound.label);
                expectedFact(campusFacts, prefix + "_dayTravelCost", money(safeAdd(outbound.cost, inbound.cost)));
                expectedFact(campusFacts, prefix + "_dayTravelTime", duration(safeAdd(outbound.minutes, inbound.minutes)));
            }
        }
        if (facts.size() < 1 || facts.size() > 100) ContractValidator.fail("facts", "Provide 1 to 100 facts.");
        facts.fields().forEachRemaining(entry -> {
            contract.id(com.fasterxml.jackson.databind.node.TextNode.valueOf(entry.getKey()), "facts key");
            String value = contract.string(entry.getValue(), "facts." + entry.getKey());
            if (value.length() > 200) ContractValidator.fail("facts." + entry.getKey(), "Fact text is too long.");
        });
        expectedFact(facts, "optionA_name", decision.path("options").get(0).path("name").asText());
        expectedFact(facts, "optionB_name", decision.path("options").get(1).path("name").asText());
        expectedFact(facts, "optionA_monthlyCost", money(cost[0]));
        expectedFact(facts, "optionB_monthlyCost", money(cost[1]));
        expectedFact(facts, "optionA_monthlyTime", duration(time[0]));
        expectedFact(facts, "optionB_monthlyTime", duration(time[1]));
        expectedFact(facts, "monthlyCostDifference", money(Math.abs(cost[1] - cost[0])));
        expectedFact(facts, "monthlyTimeDifference", duration(Math.abs(time[1] - time[0])));
        Set<String> allowedFacts = new HashSet<>(List.of(
                "optionA_name", "optionB_name", "optionA_monthlyCost", "optionB_monthlyCost",
                "optionA_monthlyTime", "optionB_monthlyTime", "monthlyCostDifference", "monthlyTimeDifference"));
        if (facts.has("monthlyCostComparison") || facts.has("monthlyTimeComparison")) {
            String optionA = decision.path("options").get(0).path("name").asText();
            String optionB = decision.path("options").get(1).path("name").asText();
            expectedFact(facts, "monthlyCostComparison", costComparison(optionA, optionB, cost[1] - cost[0]));
            expectedFact(facts, "monthlyTimeComparison", timeComparison(optionA, optionB, time[1] - time[0]));
            allowedFacts.addAll(List.of("monthlyCostComparison", "monthlyTimeComparison"));
        }
        if (mode.equals("campus")) {
            for (String prefix : List.of("optionA", "optionB")) {
                for (String suffix : List.of("leaveHome", "arriveCampus", "leaveCampus", "arriveHome",
                        "outboundMode", "inboundMode", "dayTravelCost", "dayTravelTime")) {
                    allowedFacts.add(prefix + "_" + suffix);
                }
            }
        }
        facts.fieldNames().forEachRemaining(key -> {
            if (!allowedFacts.contains(key)) ContractValidator.fail("facts." + key, "Unsupported fact key.");
        });
        if (facts.size() != allowedFacts.size()) ContractValidator.fail("facts", "Fact inventory is incomplete.");
    }

    public void response(JsonNode story, JsonNode request) {
        contract.object(story, "story");
        contract.onlyFields(story, "story", "decisionId", "simulationVersion", "sharedScenario", "moments", "monthlyReflections");
        JsonNode snapshot = request.path("snapshot");
        JsonNode options = snapshot.path("decision").path("options");
        String decisionId = snapshot.path("decision").path("id").asText();
        if (!decisionId.equals(contract.id(story.path("decisionId"), "story.decisionId"))) {
            ContractValidator.fail("story.decisionId", "Story decision ID does not match the request.");
        }
        if (contract.integer(story.path("simulationVersion"), "story.simulationVersion")
                != snapshot.path("simulationVersion").longValue()) {
            ContractValidator.fail("story.simulationVersion", "Story version does not match the request.");
        }
        JsonNode shared = contract.object(story.path("sharedScenario"), "story.sharedScenario");
        contract.onlyFields(shared, "story.sharedScenario", "title", "description");
        narrative(shared.path("title"), "story.sharedScenario.title", request.path("facts"));
        narrative(shared.path("description"), "story.sharedScenario.description", request.path("facts"));
        JsonNode moments = contract.array(story.path("moments"), "story.moments", 3, 3);
        String[] keys = {"morning", "daytime", "evening"};
        for (int i = 0; i < 3; i++) {
            JsonNode moment = contract.object(moments.get(i), "story.moments[" + i + "]");
            contract.onlyFields(moment, "story.moments[" + i + "]", "key", "options");
            if (!keys[i].equals(contract.string(moment.path("key"), "story.moments[" + i + "].key"))) {
                ContractValidator.fail("story.moments[" + i + "].key", "Story moments must be ordered morning, daytime, evening.");
            }
            paired(moment.path("options"), "story.moments[" + i + "].options", options, request.path("facts"));
        }
        paired(story.path("monthlyReflections"), "story.monthlyReflections", options, request.path("facts"));
    }

    private void paired(JsonNode entries, String path, JsonNode options, JsonNode facts) {
        contract.array(entries, path, 2, 2);
        for (int i = 0; i < 2; i++) {
            JsonNode entry = contract.object(entries.get(i), path + "[" + i + "]");
            contract.onlyFields(entry, path + "[" + i + "]", "optionId", "text");
            String expected = options.get(i).path("id").asText();
            if (!expected.equals(contract.id(entry.path("optionId"), path + "[" + i + "].optionId"))) {
                ContractValidator.fail(path + "[" + i + "].optionId", "Story option ID does not match the request.");
            }
            narrative(entry.path("text"), path + "[" + i + "].text", facts);
        }
    }

    private void narrative(JsonNode node, String path, JsonNode facts) {
        String text = contract.string(node, path);
        Matcher matcher = PLACEHOLDER.matcher(text);
        while (matcher.find()) {
            if (!facts.has(matcher.group(1))) ContractValidator.fail(path, "Unknown fact reference: " + matcher.group(1));
        }
        String withoutFacts = matcher.replaceAll("");
        if (withoutFacts.contains("{{") || withoutFacts.contains("}}") || NUMBER.matcher(withoutFacts).find()) {
            ContractValidator.fail(path, "Numeric claims must use provided fact references.");
        }
    }

    private void time(JsonNode node, String path) {
        String value = contract.string(node, path);
        if (!value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) {
            ContractValidator.fail(path, "Time must use HH:mm format.");
        }
    }

    private int timeMinutes(String value) {
        return Integer.parseInt(value.substring(0, 2)) * 60 + Integer.parseInt(value.substring(3, 5));
    }

    private String clockTime(int minutes) {
        int dayOffset = Math.floorDiv(minutes, 1440);
        int withinDay = Math.floorMod(minutes, 1440);
        int hour24 = withinDay / 60;
        int hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
        String clock = hour12 + ":" + String.format("%02d", withinDay % 60) + (hour24 < 12 ? " AM" : " PM");
        return dayOffset == 0 ? clock : clock + (dayOffset > 0 ? " (next day)" : " (previous day)");
    }

    private Choice choice(JsonNode breakdown, String activityId, String choiceId, String path) {
        for (JsonNode item : breakdown) {
            if (!activityId.equals(item.path("activityId").asText())) continue;
            String candidate = "original_activity".equals(item.path("kind").asText())
                    ? "original:" + activityId
                    : "replacement:" + item.path("tagId").asText() + ":" + activityId;
            if (!candidate.equals(choiceId)) continue;
            long events = contract.integer(item.path("eventsPerMonth"), path + ".eventsPerMonth");
            if (events < 1) ContractValidator.fail(path, "The selected travel mode has no available events.");
            long minutes = contract.integer(item.path("minutesPerEvent"), path + ".minutesPerEvent");
            long cost = contract.integer(item.path("costCentsPerEvent"), path + ".costCentsPerEvent");
            if (minutes > Integer.MAX_VALUE / 4) ContractValidator.fail(path, "Travel duration is too large for a day schedule.");
            return new Choice(events, (int) minutes, cost, contract.string(item.path("label"), path + ".label"));
        }
        ContractValidator.fail(path, "Selected travel mode is not in the calculated breakdown.");
        return null;
    }

    private record Choice(long events, int minutes, long cost, String label) {}

    private long signedInteger(JsonNode node, String path) {
        if (!node.isIntegralNumber() || !node.canConvertToLong()
                || Math.abs(node.longValue()) > 9_007_199_254_740_991L) {
            ContractValidator.fail(path, "Value must be a safe integer.");
        }
        return node.longValue();
    }

    private long safeAdd(long a, long b) {
        long result;
        try { result = Math.addExact(a, b); }
        catch (ArithmeticException exception) { ContractValidator.fail("snapshot.calculation", "Totals exceed safe integer range."); return 0; }
        if (result > 9_007_199_254_740_991L) ContractValidator.fail("snapshot.calculation", "Totals exceed safe integer range.");
        return result;
    }

    private void expectedFact(JsonNode facts, String key, String expected) {
        if (!expected.equals(facts.path(key).asText())) ContractValidator.fail("facts." + key, "Fact does not match simulation results.");
    }

    private String costComparison(String optionA, String optionB, long delta) {
        if (delta == 0) return optionA + " and " + optionB + " have equal monthly cost.";
        String higher = delta > 0 ? optionB : optionA;
        String lower = delta > 0 ? optionA : optionB;
        return higher + " costs " + money(Math.abs(delta)) + " more per month than " + lower + ".";
    }

    private String timeComparison(String optionA, String optionB, long delta) {
        if (delta == 0) return optionA + " and " + optionB + " use equal monthly time.";
        String higher = delta > 0 ? optionB : optionA;
        String lower = delta > 0 ? optionA : optionB;
        return higher + " uses " + duration(Math.abs(delta)) + " more per month than " + lower + ".";
    }

    private String money(long cents) {
        return NumberFormat.getCurrencyInstance(Locale.US).format(BigDecimal.valueOf(cents, 2));
    }

    private String duration(long minutes) {
        return (minutes / 60) + " hr " + (minutes % 60) + " min";
    }
}
