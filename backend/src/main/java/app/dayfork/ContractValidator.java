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
    private static final Pattern NONMONTHLY_BASIS = Pattern.compile(
            "(?i)\\b(?:annual(?:ly)?|yearly|year[-\\s]+long|per[-\\s]+year|one[-\\s]+time|up[-\\s]?front)\\b");
    private static final Pattern PAYMENT_LABEL = Pattern.compile("(?i)\\b(?:fee|cost|payment|charge|expense|price|purchase)s?\\b");
    private static final Pattern EXPLICIT_MONTHLY_PAYMENT = Pattern.compile(
            "(?i)\\b(?:monthly[-\\s]+(?:payment|installment|instalment)|(?:paid|billed|charged)[-\\s]+monthly)\\b");


    private static final Pattern EXPLICIT_COMPARISON_WINDOW = Pattern.compile(
            "(?iu)\\b(?:over|across)\\s+(?:exactly\\s+|the\\s+next\\s+)?([0-9]{1,3})\\s+months?\\b"
            + "|\\bcomparison\\s+(?:window|period|horizon)\\s*(?:of\\s+|is\\s+|:\\s*)?(?:exactly\\s+)?([0-9]{1,3})\\s+months?\\b"
            + "|\\b([0-9]{1,3})[\\p{Pd}\\s]+months?\\s+(?:comparison\\s+)?(?:window|horizon)\\b");

    public void decision(JsonNode decision) {
        object(decision, "decision");
        long version = integer(decision.path("schemaVersion"), "decision.schemaVersion");
        if (version != 1 && version != 2) fail("decision.schemaVersion", "Schema version must be 1 or 2.");
        if (version == 2) {
            onlyFields(decision, "decision", "schemaVersion", "comparisonMode", "usageUnit", "comparisonMonths", "id", "title", "description", "originalInput", "currency", "options", "tags");
            oneOf(decision.path("comparisonMode"), "decision.comparisonMode", "quantitative", "qualitative", "break_even", "subscription");
        } else {
            onlyFields(decision, "decision", "schemaVersion", "id", "title", "description", "originalInput", "currency", "options", "tags");
        }
        boolean breakEven = isBreakEven(decision);
        boolean subscription = isSubscription(decision);
        boolean longTerm = isLongTerm(decision);
        if (breakEven) string(decision.path("usageUnit"), "decision.usageUnit");
        else if (decision.has("usageUnit")) fail("decision.usageUnit", "A usage unit is only supported for break-even decisions.");
        if (decision.has("comparisonMonths")) {
            if (!subscription) fail("decision.comparisonMonths", "A month comparison window is only supported for subscriptions.");
            monthCount(decision.path("comparisonMonths"), "decision.comparisonMonths");
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
            if (breakEven) {
                onlyFields(option, path, "id", "name", "fixedCosts", "activities", "usageCosts");
                JsonNode costs = object(option.path("usageCosts"), path + ".usageCosts");
                onlyFields(costs, path + ".usageCosts", "upfrontCents", "perUseCents");
                numeric(costs.path("upfrontCents"), path + ".usageCosts.upfrontCents");
                numeric(costs.path("perUseCents"), path + ".usageCosts.perUseCents");
            } else if (subscription) {
                onlyFields(option, path, "id", "name", "fixedCosts", "activities", "subscriptionCosts");
                JsonNode costs = object(option.path("subscriptionCosts"), path + ".subscriptionCosts");
                onlyFields(costs, path + ".subscriptionCosts", "paymentCents", "periodMonths");
                numeric(costs.path("paymentCents"), path + ".subscriptionCosts.paymentCents");
                monthCount(costs.path("periodMonths"), path + ".subscriptionCosts.periodMonths");
            } else onlyFields(option, path, "id", "name", "fixedCosts", "activities");
            String optionId = id(option.path("id"), path + ".id");
            unique(optionIds, optionId, path + ".id");
            string(option.path("name"), path + ".name");
            JsonNode fixedCosts = array(option.path("fixedCosts"), path + ".fixedCosts", 0, longTerm ? 0 : 100);
            Set<String> fixedIds = new HashSet<>();
            for (int j = 0; j < fixedCosts.size(); j++) {
                String fixedPath = path + ".fixedCosts[" + j + "]";
                JsonNode fixed = object(fixedCosts.get(j), fixedPath);
                onlyFields(fixed, fixedPath, "id", "name", "amountCentsMonthly");
                unique(fixedIds, id(fixed.path("id"), fixedPath + ".id"), fixedPath + ".id");
                string(fixed.path("name"), fixedPath + ".name");
                numeric(fixed.path("amountCentsMonthly"), fixedPath + ".amountCentsMonthly");
            }
            JsonNode activities = array(option.path("activities"), path + ".activities", 0, longTerm ? 0 : 100);
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
        JsonNode tags = array(decision.path("tags"), "decision.tags", 0, version == 2 ? 30 : 100);
        Set<String> tagIds = new HashSet<>();
        for (int i = 0; i < tags.size(); i++) {
            String path = "decision.tags[" + i + "]";
            JsonNode tag = object(tags.get(i), path);
            if (version == 2) onlyFields(tag, path, "id", "name", "icon", "description", "group", "importance", "type", "targets");
            else onlyFields(tag, path, "id", "name", "icon", "description", "type", "targets");
            unique(tagIds, id(tag.path("id"), path + ".id"), path + ".id");
            string(tag.path("name"), path + ".name");
            string(tag.path("description"), path + ".description");
            if (tag.has("icon")) string(tag.path("icon"), path + ".icon");
            if (tag.has("group")) string(tag.path("group"), path + ".group");
            String type = longTerm
                    ? oneOf(tag.path("type"), path + ".type", "consideration")
                    : version == 2
                        ? oneOf(tag.path("type"), path + ".type", "fixed", "add_activity", "reduce_activity", "replace_activity", "consideration")
                        : oneOf(tag.path("type"), path + ".type", "fixed", "add_activity", "reduce_activity", "replace_activity");
            if (tag.has("importance")) {
                if (!type.equals("consideration")) fail(path + ".importance", "Only consideration Tags support user importance.");
                long importance = integer(tag.path("importance"), path + ".importance");
                if (importance < 1 || importance > 5) fail(path + ".importance", "User importance must be between 1 and 5.");
            }
            JsonNode targets = array(tag.path("targets"), path + ".targets", 1, type.equals("consideration") ? 2 : 100);
            Set<String> targetKeys = new HashSet<>();
            for (int j = 0; j < targets.size(); j++) {
                String targetPath = path + ".targets[" + j + "]";
                JsonNode target = object(targets.get(j), targetPath);
                if (type.equals("consideration")) onlyFields(target, targetPath, "optionId", "consideration");
                else if (type.equals("fixed")) onlyFields(target, targetPath, "optionId", "costCentsMonthly", "minutesMonthly");
                else if (type.equals("replace_activity")) onlyFields(target, targetPath, "optionId", "activityId", "replacementName", "eventsPerMonth", "costCentsPerEvent", "minutesPerEvent");
                else onlyFields(target, targetPath, "optionId", "activityId", "eventsPerMonth");
                String optionId = id(target.path("optionId"), targetPath + ".optionId");
                if (!optionIds.contains(optionId)) fail(targetPath + ".optionId", "Unknown option reference.");
                String targetKey = optionId;
                if (type.equals("consideration")) {
                    string(target.path("consideration"), targetPath + ".consideration");
                } else if (!type.equals("fixed")) {
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
        if (decision.path("schemaVersion").asInt() != 2) {
            fail("decision.schemaVersion", "Newly generated decisions must use schemaVersion 2 and the current comparison modes.");
        }
        decision(decision);
        generatedSources(decision, "decision");
        if (decision.path("schemaVersion").asInt() == 2) {
            if (!isLongTerm(decision)) rejectNonmonthlyGeneratedCharges(decision);
            validateGeneratedFrequencies(decision);
            validateGeneratedConsiderations(decision);
            validateNumericalAdjustments(decision);
            validateHousingCoverage(decision);
            validateSubscriptionCoverage(decision);
        }
    }

    private void validateGeneratedFrequencies(JsonNode decision) {
        Pattern unsupportedPeriod = Pattern.compile("(?i)\\b(?:per[\\s-]*(?:day|week)|daily|weekly)\\b|/\\s*(?:day|week)\\b");
        JsonNode options = decision.path("options");
        for (int i = 0; i < options.size(); i++) {
            JsonNode activities = options.get(i).path("activities");
            for (int j = 0; j < activities.size(); j++) {
                String label = activities.get(j).path("frequencyInput").path("label").asText();
                if (unsupportedPeriod.matcher(label).find()) {
                    fail("decision.options[" + i + "].activities[" + j + "].frequencyInput.label",
                            "Frequency inputs are monthly counts, not daily or weekly schedules. Use a unit label such as 'Round trips' "
                            + "without per day, per week, daily, or weekly. Keep eventsPerUnit only for the known event-count conversion "
                            + "(for example, two one-way trips per round trip). Do not multiply by thirty or infer days per month; "
                            + "preserve known monthly events or leave eventsPerMonth unknown when not supplied. Review every activity label.");
                }
            }
        }
    }

    private void validateGeneratedConsiderations(JsonNode decision) {
        JsonNode tags = decision.path("tags");
        for (int i = 0; i < tags.size(); i++) {
            JsonNode tag = tags.get(i);
            if (tag.has("importance")) fail("decision.tags[" + i + "].importance", "Importance is a user preference and must not be generated by the model.");
            if (!"consideration".equals(tag.path("type").asText())) continue;
            JsonNode targets = tag.path("targets");
            for (int j = 0; j < targets.size(); j++) {
                String text = targets.get(j).path("consideration").asText().strip();
                JsonNode own = null, other = null;
                for (JsonNode option : decision.path("options")) {
                    if (option.path("id").asText().equals(targets.get(j).path("optionId").asText())) own = option;
                    else other = option;
                }
                if (own != null && other != null && mentionsOptionName(text, other.path("name").asText())
                        && !mentionsOptionName(text, own.path("name").asText())) {
                    fail("decision.tags[" + i + "].targets[" + j + "].consideration",
                            "This target describes the opposing option instead of its own option. Rewrite every target for its optionId "
                            + "under the same shared condition; do not swap the other option's benefits into this branch or suggest a hybrid plan.");
                }
                if (!text.endsWith("?") && !text.matches("(?is)^if\\b.*")) {
                    fail("decision.tags[" + i + "].targets[" + j + "].consideration",
                            "Generated considerations must be questions ending with '?' or conditional concerns starting with 'If'. "
                            + "Rewrite every asserted category assumption as a question or condition to verify for the actual option. "
                            + "Do not assert product specifications, returns, or guaranteed effects.");
                }
            }
        }
    }

    private boolean mentionsOptionName(String text, String name) {
        String trimmed = name.strip();
        // Short labels such as A or B also occur as ordinary language and are not reliable evidence.
        if (trimmed.codePointCount(0, trimmed.length()) < 3) return false;
        return Pattern.compile("(?iu)(?<![\\p{L}\\p{N}_])" + Pattern.quote(trimmed) + "(?![\\p{L}\\p{N}_])")
                .matcher(text).find();
    }

    private void validateNumericalAdjustments(JsonNode decision) {
        if (!"quantitative".equals(decision.path("comparisonMode").asText())) return;
        JsonNode tags = decision.path("tags");
        for (int i = 0; i < tags.size(); i++) {
            JsonNode tag = tags.get(i);
            String name = tag.path("name").asText();
            String context = name + " " + tag.path("description").asText();
            boolean incremental = Pattern.compile("(?i)\\b(?:extra|additional|more|increase|increased|increment|incremental|upgrade|upgraded|surcharge|supplement)\\b")
                    .matcher(context).find();
            if (incremental) continue;
            String type = tag.path("type").asText();
            if (type.equals("add_activity") && Pattern.compile("(?i)\\b(?:time|duration|frequency)\\b").matcher(name).find()) {
                fail("decision.tags[" + i + "]", "An add_activity Tag must describe extra events beyond the existing baseline. "
                        + "A baseline time, duration, or frequency editor is not an additive Tag. Use a real adjustment such as Extra campus visits, "
                        + "or a replacement such as Rideshare some trips; do not add baseline usage again.");
            }
            if (!type.equals("fixed")) continue;
            for (JsonNode target : tag.path("targets")) {
                for (JsonNode option : decision.path("options")) {
                    if (!option.path("id").asText().equals(target.path("optionId").asText())) continue;
                    for (JsonNode fixed : option.path("fixedCosts")) {
                        String baseline = fixed.path("name").asText();
                        String category = fixedCostCategory(name);
                        if (normalizedCostName(name).equals(normalizedCostName(baseline))
                                || (isBaselineCostEditor(name) && !category.isEmpty() && category.equals(fixedCostCategory(baseline)))) {
                            fail("decision.tags[" + i + "]", "This fixed Tag repeats a cost already present in its target option's baseline. "
                                    + "Tags must be optional changes beyond the baseline, not another input for the same rent, utilities, or groceries. "
                                    + "Use a distinct optional service or explicitly incremental extra cost; never charge the baseline twice. "
                                    + "Review every numerical Tag for the same issue before returning the corrected decision.");
                        }
                    }
                }
            }
        }
    }

    private String normalizedCostName(String name) {
        return name.toLowerCase(java.util.Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ")
                .replaceAll("\\b(?:monthly|costs?|fees?|amounts?|charges?|expenses?|prices?|expected|typical|baseline|total)\\b", " ")
                .replaceAll("\\s+", " ").strip();
    }

    private boolean isBaselineCostEditor(String name) {
        return normalizedCostName(name).matches("(?:(?:housing|apartment) )?rent|(?:household )?utilities|(?:household )?grocer(?:y|ies)");
    }

    private String fixedCostCategory(String name) {
        String normalized = normalizedCostName(name);
        if (normalized.matches(".*\\brent\\b.*")) return "rent";
        if (normalized.matches(".*\\butilities\\b.*")) return "utilities";
        if (normalized.matches(".*\\bgrocer(?:y|ies)\\b.*")) return "groceries";
        return "";
    }

    private void rejectNonmonthlyGeneratedCharges(JsonNode decision) {
        // Only inspect an explicit payment label, not broad decision-domain keywords.
        // The v1 monthly-equivalent contract remains compatible for existing clients.
        for (int i = 0; i < decision.path("options").size(); i++) {
            JsonNode fixedCosts = decision.path("options").get(i).path("fixedCosts");
            for (int j = 0; j < fixedCosts.size(); j++) {
                String label = fixedCosts.get(j).path("name").asText();
                if (NONMONTHLY_BASIS.matcher(label).find() && PAYMENT_LABEL.matcher(label).find()
                        && !EXPLICIT_MONTHLY_PAYMENT.matcher(label).find()) {
                    fail("decision.options[" + i + "].fixedCosts[" + j + "].amountCentsMonthly",
                            "This charge is explicitly annual or upfront, not monthly. If it is an upfront-plus-per-use purchase comparison, "
                            + "use comparisonMode break_even with usageCosts. For an annual-versus-monthly subscription decision, use comparisonMode subscription "
                            + "with subscriptionCosts, empty fixedCosts and activities, and consideration Tags. In either case, do not relabel, divide, or amortize "
                            + "the charge into a monthly amount.");
                }
            }
        }
    }

    static boolean isQualitative(JsonNode decision) {
        return decision.path("schemaVersion").asInt() == 2
                && "qualitative".equals(decision.path("comparisonMode").asText());
    }

    static boolean isBreakEven(JsonNode decision) {
        return decision.path("schemaVersion").asInt() == 2
                && "break_even".equals(decision.path("comparisonMode").asText());
    }

    static boolean isSubscription(JsonNode decision) {
        return decision.path("schemaVersion").asInt() == 2
                && "subscription".equals(decision.path("comparisonMode").asText());
    }

    static boolean isLongTerm(JsonNode decision) {
        return isQualitative(decision) || isBreakEven(decision) || isSubscription(decision);
    }

    long monthCount(JsonNode node, String path) {
        long months = integer(node, path);
        if (months < 1 || months > 120) fail(path, "Month counts must be between 1 and 120.");
        return months;
    }

    private void validateHousingCoverage(JsonNode decision) {
        if (!"quantitative".equals(decision.path("comparisonMode").asText())) return;
        String input = decision.path("originalInput").asText().toLowerCase(java.util.Locale.ROOT);
        boolean campusAlternatives = input.matches("(?s).*\\bon[-\\s]+campus\\b.*")
                && input.matches("(?s).*\\boff[-\\s]+campus\\b.*");
        boolean housing = input.matches("(?s).*\\b(?:live|living|housing|rent|renting|dorm|dormitory|apartment|accommodation)\\b.*");
        boolean narrowed = input.matches("(?s).*\\b(?:only|just|exactly|limit|focus|fewer|at most|no more than)\\b.*");
        if (!campusAlternatives || !housing || narrowed) return;
        JsonNode tags = decision.path("tags");
        boolean numerical = false, qualitative = false;
        for (JsonNode tag : tags) {
            if ("consideration".equals(tag.path("type").asText())) qualitative = true;
            else numerical = true;
        }
        if (tags.size() < 8 || !numerical || !qualitative) {
            fail("decision.tags", "A broad on-campus versus off-campus housing comparison needs fuller coverage: aim for 8 to 10 "
                    + "distinct relevant factors mixing supported numerical adjustments and qualitative living concerns. "
                    + "Do not pad with duplicates, invent amounts, or convert privacy/social life into numeric scores. "
                    + "Preserve the existing baseline and use unknown numeric inputs where needed.");
        }
    }

    private void validateSubscriptionCoverage(JsonNode decision) {
        String input = decision.path("originalInput").asText().toLowerCase(java.util.Locale.ROOT);
        boolean annual = input.matches("(?s).*\\b(?:annual|annually|yearly|year[-\\s]+long|year[-\\s]+card|year[-\\s]+pass|year[-\\s]+membership)\\b.*");
        boolean monthly = input.matches("(?s).*\\b(?:monthly|month[-\\s]+card|month[-\\s]+pass|month[-\\s]+membership|month[-\\s]+to[-\\s]+month)\\b.*");
        boolean billingProduct = input.matches("(?s).*\\b(?:cards?|pass(?:es)?|memberships?|subscriptions?|billing[-\\s]+plans?)\\b.*");
        if (annual && monthly && billingProduct && !isSubscription(decision)) {
            fail("decision.comparisonMode", "Annual/year-card versus monthly/month-card comparisons require subscription mode even when prices are missing. "
                    + "Use paymentCents with unknown values where needed and plain periodMonths for the stated billing periods; do not force qualitative mode or monthly amortization.");
        }
        if (!isSubscription(decision)) return;
        validateExplicitComparisonWindow(decision, input);
        boolean narrowed = input.matches("(?s).*\\b(?:only|just|exactly|limit|focus|fewer|at most|no more than)\\b.*");
        if (!narrowed && decision.path("tags").size() < 5) {
            fail("decision.tags", "A broad subscription comparison needs fuller relevant factor coverage. Aim for 5 to 7 distinct "
                    + "considerations, such as usage consistency, upfront affordability, changing needs, flexibility, and renewal terms. "
                    + "Do not pad with duplicate price comparisons, invent a gym context when none was given, or generate personal importance values.");
        }
    }

    private void validateExplicitComparisonWindow(JsonNode decision, String input) {
        // Inspect only an explicit comparison-window phrase, never arbitrary prices or billing-period numbers.
        Set<Integer> requestedWindows = new HashSet<>();
        var matcher = EXPLICIT_COMPARISON_WINDOW.matcher(input);
        while (matcher.find()) {
            for (int group = 1; group <= matcher.groupCount(); group++) {
                if (matcher.group(group) != null) requestedWindows.add(Integer.parseInt(matcher.group(group)));
            }
        }
        if (requestedWindows.size() != 1) return;
        int requested = requestedWindows.iterator().next();
        if (!decision.has("comparisonMonths") || decision.path("comparisonMonths").asInt() != requested) {
            fail("decision.comparisonMonths", "The user explicitly requested a comparison window of " + requested
                    + " months. Include comparisonMonths: " + requested + " exactly; do not omit it and fall back to twelve months. "
                    + "The comparison window is separate from each option's periodMonths. Preserve the supplied payment amounts "
                    + "and billing periods; do not amortize payments or change them to fit the window.");
        }
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
