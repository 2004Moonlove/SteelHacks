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
    private static final Pattern NUMBER = Pattern.compile("\\S*[0-9]\\S*");
    private static final String SPELLED_USAGE_COUNT = "(?:once|twice|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"
            + "\\s+(?:times?|visits?|sessions?|workouts?|trips?|meals?|cups?|evenings?|mornings?|afternoons?|nights?|days?))";
    private static final Pattern SPELLED_USAGE_FREQUENCY = Pattern.compile(
            "(?i)\\b" + SPELLED_USAGE_COUNT + "\\s+(?:a|per|each|every)\\s+(?:day|week|month)\\b"
            + "|\\b(?:each|every|per)\\s+(?:day|week|month)\\b[^.!?;\\n]{0,100}\\b" + SPELLED_USAGE_COUNT + "\\b");
    private static final Pattern CALENDAR_PAYBACK = Pattern.compile(
            "(?i)(?:\\b(?:how\\s+many|(?:the\\s+)?number\\s+of)\\s+(?:days?|weeks?|months?|years?)\\b[^.!?\\n]{0,220}\\b(?:equal|cover|offset|recover|recoup|break(?:s)?[-\\s]*even|upfront|price|cost|expense)\\b"
            + "|\\b(?:payback|break(?:s)?[-\\s]*even|recover|recoup|offset|pay(?:s)?\\s+for\\s+itself)\\b[^.!?\\n]{0,100}\\b(?:days?|weeks?|months?|years?)\\b"
            + "|\\b(?:days?|weeks?|months?|years?)\\b[^.!?\\n]{0,100}\\b(?:payback|break(?:s)?[-\\s]*even|recover|recoup|offset|pay(?:s)?\\s+for\\s+itself)\\b"
            + "|\\b(?:how\\s+long|time\\s+to)\\b[^.!?\\n]{0,100}\\b(?:payback|break(?:s)?[-\\s]*even|recover|recoup|offset|pay(?:s)?\\s+for\\s+itself)\\b)");
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
        if (ContractValidator.isSubscription(decision)) {
            subscriptionRequest(request, snapshot, calculation, decision);
            return;
        }
        if (ContractValidator.isBreakEven(decision)) {
            breakEvenRequest(request, snapshot, calculation, decision);
            return;
        }
        if (ContractValidator.isQualitative(decision)) {
            qualitativeRequest(request, snapshot, calculation, decision);
            return;
        }
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
            JsonNode value = entry.getValue();
            // Comparison facts contain two valid option names plus deterministic amounts.
            // Their exact content is checked below; narrative text limits do not apply.
            if (!value.isTextual() || value.asText().isBlank()
                    || value.asText().length() > 2 * ContractValidator.MAX_TEXT_LENGTH + 100) {
                ContractValidator.fail("facts." + entry.getKey(), "Fact text must match the supported simulation facts.");
            }
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

    private void subscriptionRequest(JsonNode request, JsonNode snapshot, JsonNode calculation, JsonNode decision) {
        contract.onlyFields(request, "request", "snapshot", "context", "facts");
        contract.onlyFields(snapshot, "snapshot", "decision", "enabledTagIds", "simulationVersion", "calculation");
        new SubscriptionReconciler(contract).reconcile(snapshot);
        JsonNode context = contract.object(request.path("context"), "context");
        contract.onlyFields(context, "context", "mode");
        contract.oneOf(context.path("mode"), "context.mode", "qualitative");
        JsonNode facts = contract.object(request.path("facts"), "facts");
        contract.onlyFields(facts, "facts", "comparisonMonths", "subscriptionCostComparison",
                "optionA_name", "optionA_payment", "optionA_periodMonths", "optionA_totalCost", "optionA_paymentCount", "optionA_coverageMonths",
                "optionB_name", "optionB_payment", "optionB_periodMonths", "optionB_totalCost", "optionB_paymentCount", "optionB_coverageMonths");
        long months = calculation.path("comparisonMonths").longValue();
        expectedFact(facts, "comparisonMonths", Long.toString(months));
        String[] names = new String[2], totals = new String[2];
        for (int i = 0; i < 2; i++) {
            String prefix = i == 0 ? "optionA" : "optionB";
            JsonNode option = decision.path("options").get(i);
            JsonNode costs = option.path("subscriptionCosts");
            JsonNode result = calculation.path("options").get(i);
            names[i] = option.path("name").asText();
            totals[i] = money(result.path("totalCostCents").longValue());
            expectedFact(facts, prefix + "_name", names[i]);
            expectedFact(facts, prefix + "_payment", money(costs.path("paymentCents").path("value").longValue()));
            expectedFact(facts, prefix + "_periodMonths", Long.toString(costs.path("periodMonths").longValue()));
            expectedFact(facts, prefix + "_totalCost", totals[i]);
            expectedFact(facts, prefix + "_paymentCount", Long.toString(result.path("paymentCount").longValue()));
            expectedFact(facts, prefix + "_coverageMonths", Long.toString(result.path("coverageMonths").longValue()));
        }
        expectedFact(facts, "subscriptionCostComparison", names[0] + " costs " + totals[0] + " and " + names[1] + " costs " + totals[1]
                + " over " + months + " " + (months == 1 ? "month" : "months") + ".");
        facts.fields().forEachRemaining(entry -> {
            if (!entry.getValue().isTextual()) ContractValidator.fail("facts." + entry.getKey(), "A canonical text fact is required.");
        });
    }

    private void breakEvenRequest(JsonNode request, JsonNode snapshot, JsonNode calculation, JsonNode decision) {
        contract.onlyFields(request, "request", "snapshot", "context", "facts");
        contract.onlyFields(snapshot, "snapshot", "decision", "enabledTagIds", "simulationVersion", "calculation");
        new BreakEvenReconciler(contract).reconcile(snapshot);
        JsonNode context = contract.object(request.path("context"), "context");
        contract.onlyFields(context, "context", "mode");
        contract.oneOf(context.path("mode"), "context.mode", "qualitative");
        JsonNode facts = contract.object(request.path("facts"), "facts");
        contract.onlyFields(facts, "facts", "optionA_name", "optionB_name", "optionA_upfrontCost", "optionB_upfrontCost",
                "optionA_perUseCost", "optionB_perUseCost", "usageUnit", "breakEvenSummary");
        for (int i = 0; i < 2; i++) {
            String prefix = i == 0 ? "optionA" : "optionB";
            JsonNode option = decision.path("options").get(i);
            expectedFact(facts, prefix + "_name", option.path("name").asText());
            expectedFact(facts, prefix + "_upfrontCost", money(option.path("usageCosts").path("upfrontCents").path("value").longValue()));
            expectedFact(facts, prefix + "_perUseCost", money(option.path("usageCosts").path("perUseCents").path("value").longValue()));
        }
        expectedFact(facts, "usageUnit", decision.path("usageUnit").asText());
        JsonNode crossing = calculation.path("crossover");
        String summary = switch (crossing.path("kind").asText()) {
            case "equal" -> "Both options have the same modeled cost at every use count.";
            case "no_crossing" -> "There is no positive break-even point with these costs.";
            default -> {
                String name = decision.path("options").get(0).path("id").asText().equals(crossing.path("recoveryOptionId").asText())
                        ? decision.path("options").get(0).path("name").asText() : decision.path("options").get(1).path("name").asText();
                yield name + " has the same or lower modeled cost from use " + crossing.path("firstWholeUse").longValue() + " onward.";
            }
        };
        expectedFact(facts, "breakEvenSummary", summary);
        facts.fields().forEachRemaining(entry -> {
            if (!entry.getValue().isTextual()) ContractValidator.fail("facts." + entry.getKey(), "A canonical text fact is required.");
        });
    }

    private void qualitativeRequest(JsonNode request, JsonNode snapshot, JsonNode calculation, JsonNode decision) {
        contract.onlyFields(request, "request", "snapshot", "context", "facts");
        contract.onlyFields(snapshot, "snapshot", "decision", "enabledTagIds", "simulationVersion", "calculation");
        contract.onlyFields(calculation, "snapshot.calculation", "status");
        contract.oneOf(calculation.path("status"), "snapshot.calculation.status", "qualitative");
        JsonNode context = contract.object(request.path("context"), "context");
        contract.onlyFields(context, "context", "mode");
        contract.oneOf(context.path("mode"), "context.mode", "qualitative");
        JsonNode facts = contract.object(request.path("facts"), "facts");
        contract.onlyFields(facts, "facts", "optionA_name", "optionB_name");
        for (int i = 0; i < 2; i++) {
            String key = i == 0 ? "optionA_name" : "optionB_name";
            contract.string(facts.path(key), "facts." + key);
            expectedFact(facts, key, decision.path("options").get(i).path("name").asText());
        }
    }

    public void response(JsonNode story, JsonNode request) {
        contract.object(story, "story");
        JsonNode snapshot = request.path("snapshot");
        boolean qualitative = ContractValidator.isLongTerm(snapshot.path("decision"));
        if (qualitative) {
            contract.onlyFields(story, "story", "mode", "decisionId", "simulationVersion", "sharedScenario", "moments", "monthlyReflections", "advice");
            contract.oneOf(story.path("mode"), "story.mode", "qualitative");
        } else {
            contract.onlyFields(story, "story", "decisionId", "simulationVersion", "sharedScenario", "moments", "monthlyReflections", "advice");
        }
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
        String[] keys = qualitative ? new String[]{"beginning", "during", "later"} : new String[]{"morning", "daytime", "evening"};
        for (int i = 0; i < 3; i++) {
            JsonNode moment = contract.object(moments.get(i), "story.moments[" + i + "]");
            contract.onlyFields(moment, "story.moments[" + i + "]", "key", "options");
            if (!keys[i].equals(contract.string(moment.path("key"), "story.moments[" + i + "].key"))) {
                ContractValidator.fail("story.moments[" + i + "].key", "Story moments must be ordered " + String.join(", ", keys) + ".");
            }
            paired(moment.path("options"), "story.moments[" + i + "].options", options, request.path("facts"));
        }
        if (story.has("advice")) paired(story.path("advice"), "story.advice", options, request.path("facts"));
        if (qualitative) contract.array(story.path("monthlyReflections"), "story.monthlyReflections", 0, 0);
        else paired(story.path("monthlyReflections"), "story.monthlyReflections", options, request.path("facts"));
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
        if (withoutFacts.contains("{{") || withoutFacts.contains("}}")) {
            ContractValidator.fail(path, "Fact placeholders must use exactly {{factId}} with a provided fact ID and balanced braces.");
        }
        if (facts.has("breakEvenSummary") && CALENDAR_PAYBACK.matcher(withoutFacts).find()) {
            ContractValidator.fail(path, "Break-even comparisons use a use count only, not calendar time. "
                    + "No daily, weekly, monthly, or yearly usage frequency was provided. Remove the conversion to days, weeks, months, or years "
                    + "and use the canonical {{breakEvenSummary}} sentence; do not infer how long payback takes.");
        }
        if (facts.has("subscriptionCostComparison")) validateSubscriptionNarrative(withoutFacts, path);
        Matcher frequency = SPELLED_USAGE_FREQUENCY.matcher(withoutFacts);
        if (frequency.find()) {
            ContractValidator.fail(path, "Spelled-out usage frequencies are numerical claims and must not be invented. Found '"
                    + frequency.group().substring(0, Math.min(frequency.group().length(), 100))
                    + "'. Remove the numeric attendance or usage schedule from every story field. Use a qualitative phrase such as "
                    + "'when you use the gym' or 'as your routine allows'; do not replace the words with digits or invent a fact ID.");
        }
        Matcher number = NUMBER.matcher(withoutFacts);
        if (number.find()) {
            String token = number.group();
            ContractValidator.fail(path, "Numeric claims must use provided fact references. Found literal '"
                    + token.substring(0, Math.min(token.length(), 80)) + "'. Use the option-name placeholder for names; "
                    + "paraphrase a selected digit-bearing task label in words (for example, spatial rendering), "
                    + "or omit unsupported detail. Do not repeat the literal or invent a fact ID.");
        }
    }

    private void validateSubscriptionNarrative(String text, String path) {
        Pattern permission = Pattern.compile("(?i)\\b(?:can|could|may|are free to|are able to)\\s+(?:choose\\s+to\\s+)?(?:skip|pause|cancel|suspend|stop)\\b"
                + "(?=\\s+(?:(?:a|an|the|your|this|that|one|another)\\s+)?(?:month|payment|renewal|membership|subscription|plan|access|service|billing|arrangement)\\b"
                + "|\\s+(?:paying|renewing)\\b|\\s+(?:if|when|whenever|subject)\\b|\\s*(?:[,;.!?]|$))");
        Pattern qualified = Pattern.compile("(?i)(?:\\bif\\b[^.!?]{0,90}\\b(?:terms?|contract|policy|policies)\\b[^.!?]{0,60}\\b(?:allow|permit)|"
                + "\\bsubject\\s+to\\b[^.!?]{0,90}\\b(?:terms?|contract|policy|policies)|"
                + "\\b(?:terms?|contract|policy|policies)\\b[^.!?]{0,60}\\b(?:permitting|allowing))");
        Pattern endAssumption = Pattern.compile("(?i)\\b(?:comparison|selected)\\s+window\\b[^.!?]{0,240}"
                + "\\b(?:you\\s+(?:stop|cancel)|(?:access|subscription|membership)\\s+(?:ends|stops)|no\\s+longer\\s+need)\\b");
        for (String sentence : text.split("[.!?]+")) {
            if (permission.matcher(sentence).find() && !qualified.matcher(sentence).find()) {
                ContractValidator.fail(path, "Pause, skip, cancel, or stop permissions were not supplied. In the same sentence, "
                        + "make any such possibility explicitly subject to actual contract terms, such as 'if the terms permit' or 'subject to the actual terms'. "
                        + "A changing schedule alone does not grant cancellation rights; preserve the shared hypothetical scene without inventing those rights.");
            }
            if (endAssumption.matcher(sentence).find()
                    && !Pattern.compile("(?i)\\b(?:if|whether|might|could)\\b").matcher(sentence).find()) {
                ContractValidator.fail(path, "The comparison window is an accounting window, not the end of the user's need or service. "
                        + "Do not say they stop, cancel, or no longer need access because the window ends. Describe an ongoing situation "
                        + "or a conditional decision subject to actual terms, while leaving the modeled payment totals unchanged.");
            }
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
