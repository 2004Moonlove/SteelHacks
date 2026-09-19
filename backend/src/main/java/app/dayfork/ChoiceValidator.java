package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Structural and evidence validation. This does not claim to prove semantic truth of model interpretations. */
@Component
public class ChoiceValidator {
    private static final double MAX_SAFE = 9_007_199_254_740_991d;
    private static final Set<String> TYPES = Set.of("number", "money", "duration", "date", "boolean", "category", "text");
    private static final Set<String> SOURCES = Set.of("user_input", "user_edit", "model_suggestion", "demo", "material", "unknown", "derived");
    private static final Set<String> RULES = Set.of("total_cost", "first_payment", "monthly_payment", "cost_per_use", "total_time", "monthly_time");
    private static final Set<String> LABELS = Set.of("urgency", "scarcity", "social_pressure", "emotional_pressure", "unclear_price", "unclear_terms", "unsupported_claim", "normal_marketing", "disclosed", "conflict");

    public void request(JsonNode node, String... fields) { shape(node, "request", Set.of(fields), Set.of()); }

    public String input(JsonNode node, String key, int max) { return text(node.path(key), key, 1, max).trim(); }

    public void decision(JsonNode decision, boolean generated, String input) {
        shape(decision, "decision", set("schemaVersion id version title description originalInput domain decisionType template currency goals context options factors primaryFactorId questions assumptions mode"), Set.of());
        require(decision.path("schemaVersion").isIntegralNumber() && decision.path("schemaVersion").intValue() == 2, "schemaVersion", "Expected schemaVersion 2.");
        id(decision.path("id"), "id");
        integer(decision.path("version"), "version", 0, MAX_SAFE);
        for (String key : new String[]{"title", "domain", "decisionType"}) text(decision.path(key), key, 1, 250);
        text(decision.path("description"), "description", 0, 4000);
        text(decision.path("originalInput"), "originalInput", 0, 8000);
        one(decision.path("template"), "template", Set.of("general", "subscription", "housing", "purchase"));
        one(decision.path("currency"), "currency", Set.of("USD", "CNY", "EUR", "GBP", "CAD"));
        one(decision.path("mode"), "mode", Set.of("live", "demo", "manual"));
        array(decision.path("options"), "options", 2, 6);
        Map<String, JsonNode> options = indexed(decision.path("options"), "options");
        Map<String, JsonNode> allMaterials = new LinkedHashMap<>();
        int allMaterialChars = 0;
        Set<String> allMaterialIds = new HashSet<>();
        for (JsonNode option : decision.path("options")) {
            String p = "options." + option.path("id").asText();
            shape(option, p, set("id name description costs costsComplete minutesPerUse minutesPerMonth materials"), Set.of());
            text(option.path("name"), p + ".name", 1, 150);
            text(option.path("description"), p + ".description", 0, 3000);
            bool(option.path("costsComplete"), p + ".costsComplete");
            array(option.path("costs"), p + ".costs", 0, 30);
            indexed(option.path("costs"), p + ".costs");
            array(option.path("materials"), p + ".materials", 0, 10);
            Map<String, JsonNode> materials = indexed(option.path("materials"), p + ".materials");
            allMaterials.putAll(materials);
            for (JsonNode material : option.path("materials")) {
                require(allMaterialIds.add(material.path("id").asText()), p + ".materials.id", "Material IDs must be unique across the decision.");
                shape(material, p + ".materials", set("id title text"), Set.of());
                text(material.path("title"), p + ".materials.title", 1, 200);
                allMaterialChars += text(material.path("text"), p + ".materials.text", 0, 12000).length();
            }
            if (generated) {
                require(materials.isEmpty(), p + ".materials", "Generation cannot invent supplied materials.");
                if (option.path("costsComplete").asBoolean()) require(explicitCompleteCosts(input), p + ".costsComplete", "Only explicit complete-cost/no-other-fees information can mark costs complete.");
            }
            for (JsonNode cost : option.path("costs")) {
                shape(cost, p + ".costs", set("id name cadence amount"), Set.of());
                text(cost.path("name"), p + ".costs.name", 1, 150);
                String cadence = one(cost.path("cadence"), p + ".costs.cadence", Set.of("one_time", "monthly", "annual", "per_use"));
                if (generated) {
                    String evidence = (cost.path("name").asText() + " " + cost.path("amount").path("quote").asText()).toLowerCase(Locale.ROOT);
                    if (evidence.matches("(?s).*(?:\\bannual\\b|\\byearly\\b|per year|年卡|年费|每年).*") && !evidence.matches("(?s).*(?:deposit|joining|registration|押金|注册费).*$")) {
                        require(cadence.equals("annual"), p + ".costs.cadence", "An annual/yearly membership fee must use cadence=annual, not one_time or monthly; it renews for each started year.");
                    }
                }
                value(cost.path("amount"), p + ".costs.amount", "money", generated, input, materials);
            }
            value(option.path("minutesPerUse"), p + ".minutesPerUse", "duration", generated, input, materials);
            value(option.path("minutesPerMonth"), p + ".minutesPerMonth", "duration", generated, input, materials);
        }
        require(allMaterialChars <= 60000, "options.materials", "Combined materials must not exceed 60,000 characters.");
        JsonNode context = decision.path("context");
        shape(context, "context", set("months usesPerMonth budgetCents"), Set.of());
        value(context.path("months"), "context.months", "number", generated, input, allMaterials);
        if (!context.path("months").path("value").isNull()) integer(context.path("months").path("value"), "context.months.value", 1, 120);
        value(context.path("usesPerMonth"), "context.usesPerMonth", "number", generated, input, allMaterials);
        if (!context.path("usesPerMonth").path("value").isNull()) number(context.path("usesPerMonth").path("value"), "context.usesPerMonth.value", 0, MAX_SAFE);
        value(context.path("budgetCents"), "context.budgetCents", "money", generated, input, allMaterials);
        array(decision.path("goals"), "goals", 0, 20);
        for (JsonNode goal : decision.path("goals")) {
            shape(goal, "goals", set("text source quote"), Set.of());
            text(goal.path("text"), "goals.text", 1, 2000);
            one(goal.path("source"), "goals.source", Set.of("user_input", "model_suggestion"));
            text(goal.path("quote"), "goals.quote", 0, 4000);
            if (generated && goal.path("source").asText().equals("user_input")) evidence(goal.path("quote"), decision.path("originalInput").asText(), "goals.quote");
        }
        array(decision.path("factors"), "factors", 0, 40);
        factors(decision.path("factors"), decision, generated, input, false);
        JsonNode primary = decision.path("primaryFactorId");
        if (!primary.isNull()) {
            String selected = id(primary, "primaryFactorId");
            JsonNode factor = indexed(decision.path("factors"), "factors").get(selected);
            require(factor != null, "primaryFactorId", "Primary factor must exist.");
            require(factor.path("purpose").asText().equals("preference"), "primaryFactorId", "Primary factor must be a preference.");
            if (generated) require(factor.path("confirmed").asBoolean() && !factor.path("origin").asText().equals("model"), "primaryFactorId", "Only a confirmed user preference can rank options.");
        }
        if (generated) requireExplicitCostPriority(decision, input);
        strings(decision.path("questions"), "questions", generated ? 3 : 10, 1000);
        strings(decision.path("assumptions"), "assumptions", 20, 1000);
        if (generated) generatedLanguage(decision, "decision", input);
    }

    public void suggestions(JsonNode output, JsonNode decision, String instruction) {
        shape(output, "response", set("decisionId decisionVersion factors questions"), Set.of());
        binding(output, decision);
        generatedLanguage(output, "response", decision.path("originalInput").asText() + "\n" + instruction);
        array(output.path("factors"), "factors", 0, 8);
        factors(output.path("factors"), decision, true, decision.path("originalInput").asText() + "\n" + instruction, true);
        strings(output.path("questions"), "questions", 3, 1000);
        Set<String> existingIds = indexed(decision.path("factors"), "existingFactors").keySet();
        Set<String> existingKeys = new HashSet<>();
        for (JsonNode factor : decision.path("factors")) existingKeys.add(semanticKey(factor));
        for (JsonNode factor : output.path("factors")) {
            require(!existingIds.contains(factor.path("id").asText()), "factors.id", "A suggestion must have a new ID and cannot replace existing content.");
            require(!existingKeys.contains(semanticKey(factor)), "factors.name", "An existing factor already covers this factor; suggest only new factors.");
        }
    }

    private void factors(JsonNode factors, JsonNode decision, boolean generated, String input, boolean proposal) {
        indexed(factors, "factors");
        Map<String, JsonNode> options = indexed(decision.path("options"), "options");
        Set<String> names = new HashSet<>();
        for (JsonNode factor : factors) {
            String p = "factors." + factor.path("id").asText();
            shape(factor, p, set("id name reason optionIds dataType unit allowedValues direction purpose importance target values origin confirmed"), Set.of("ruleId", "userQuote"));
            text(factor.path("name"), p + ".name", 1, 150);
            if (generated) require(names.add(semanticKey(factor)), p + ".name", "Duplicate factor name or computation purpose.");
            text(factor.path("reason"), p + ".reason", generated ? 1 : 0, 2000);
            strings(factor.path("optionIds"), p + ".optionIds", 6, 80);
            require(!factor.path("optionIds").isEmpty(), p + ".optionIds", "Select at least one option.");
            Set<String> applicable = new HashSet<>();
            for (JsonNode optionId : factor.path("optionIds")) require(options.containsKey(optionId.asText()) && applicable.add(optionId.asText()), p + ".optionIds", "Option references must exist and be unique.");
            String type = one(factor.path("dataType"), p + ".dataType", TYPES);
            text(factor.path("unit"), p + ".unit", 0, 80);
            if (type.equals("money")) require(factor.path("unit").asText().equals(decision.path("currency").asText()), p + ".unit", "Money factor unit must match decision currency.");
            if (type.equals("duration")) require(factor.path("unit").asText().equals("minutes"), p + ".unit", "Duration factors use canonical minutes.");
            strings(factor.path("allowedValues"), p + ".allowedValues", 30, 150);
            Set<String> categories = new HashSet<>();
            for (JsonNode category : factor.path("allowedValues")) require(categories.add(category.asText()), p + ".allowedValues", "Allowed values must be unique.");
            String direction = one(factor.path("direction"), p + ".direction", Set.of("minimize", "maximize", "target", "none"));
            String purpose = one(factor.path("purpose"), p + ".purpose", Set.of("hard", "preference", "reference"));
            String origin = one(factor.path("origin"), p + ".origin", Set.of("user", "model", "demo"));
            bool(factor.path("confirmed"), p + ".confirmed");
            integer(factor.path("importance"), p + ".importance", 1, 5);
            JsonNode target = factor.path("target");
            shape(target, p + ".target", set("min max desired"), Set.of());
            for (String key : new String[]{"min", "max", "desired"}) if (!target.path(key).isNull()) scalar(target.path(key), p + ".target." + key, type, factor.path("allowedValues"));
            if (!target.path("min").isNull() && !target.path("max").isNull()) {
                boolean ordered = target.path("min").isNumber() ? target.path("min").doubleValue() <= target.path("max").doubleValue() : target.path("min").asText().compareTo(target.path("max").asText()) <= 0;
                require(ordered, p + ".target", "Target minimum cannot exceed maximum.");
            }
            boolean hasTarget = !target.path("min").isNull() || !target.path("max").isNull() || !target.path("desired").isNull();
            if (purpose.equals("hard")) {
                if (generated || (factor.path("confirmed").asBoolean() && !origin.equals("model"))) require(hasTarget, p + ".target", "A hard requirement needs an explicit target.");
                if (generated) {
                    require(!origin.equals("model") || !factor.path("confirmed").asBoolean(), p + ".confirmed", "Model proposals cannot claim user confirmation.");
                    if (!origin.equals("model")) require(factor.path("confirmed").asBoolean(), p + ".confirmed", "A user hard requirement must be confirmed.");
                }
            }
            if (Set.of("boolean", "category", "text").contains(type)) require(target.path("min").isNull() && target.path("max").isNull(), p + ".target", "This type needs a desired value rather than a numeric range.");
            if (type.equals("text")) require(purpose.equals("reference") && direction.equals("none"), p, "Text factors are reference-only; use category for explicit comparisons.");
            if (type.equals("boolean")) require(direction.equals("target") || direction.equals("none"), p + ".direction", "Boolean factors compare to an explicit target.");
            if (type.equals("category") && (direction.equals("minimize") || direction.equals("maximize"))) {
                require(factor.path("allowedValues").size() >= 2 && (!generated || !origin.equals("model")), p + ".allowedValues", "Ordered categories require a user-supplied scale.");
            }
            if (generated) {
                String expectedRule = computedRule(factor);
                if (expectedRule != null) require(factor.path("ruleId").asText().equals(expectedRule), p + ".ruleId", "This calculated factor must use ruleId=" + expectedRule + ". Do not rank with model-computed static totals. Budget checks may be omitted as a duplicate of context.budgetCents.");
            }
            if (factor.has("ruleId")) {
                String rule = one(factor.path("ruleId"), p + ".ruleId", RULES);
                require(type.equals(rule.contains("time") ? "duration" : "money"), p + ".dataType", "Computation rule and data type must agree.");
            }
            if (factor.has("userQuote")) text(factor.path("userQuote"), p + ".userQuote", 1, 4000);
            if (generated) {
                require(!origin.equals("demo"), p + ".origin", "Live generation cannot return demo content.");
                if (origin.equals("model")) require(!factor.path("confirmed").asBoolean(), p + ".confirmed", "Model suggestions require review.");
                if (origin.equals("user")) {
                    evidence(factor.path("userQuote"), input, p + ".userQuote");
                    if (purpose.equals("hard") && factor.path("confirmed").asBoolean()) require(hasExplicitRequirement(factor.path("userQuote").asText()), p + ".userQuote", "A confirmed hard requirement needs explicit necessity or a firm limit in its quote. A bare wish or desired outcome is a preference, not an exclusion rule.");
                    if (type.equals("money")) for (String key : new String[]{"min", "max", "desired"}) {
                        if (!target.path(key).isNull()) moneyEvidence(target.path(key), factor.path("userQuote").asText(), p + ".target." + key);
                    }
                }
                if (proposal) require(!factor.path("confirmed").asBoolean() || origin.equals("user"), p + ".confirmed", "Suggestions cannot confirm inferred needs.");
            }
            require(factor.path("values").isObject(), p + ".values", "Expected values keyed by option ID.");
            factor.path("values").fields().forEachRemaining(entry -> {
                require(applicable.contains(entry.getKey()), p + ".values", "Factor values must belong to applicable options.");
                Map<String, JsonNode> materials = indexed(options.get(entry.getKey()).path("materials"), "materials");
                value(entry.getValue(), p + ".values." + entry.getKey(), type, generated, input, materials);
                if (!entry.getValue().path("value").isNull()) scalar(entry.getValue().path("value"), p + ".values." + entry.getKey(), type, factor.path("allowedValues"));
            });
            for (String optionId : applicable) require(factor.path("values").has(optionId), p + ".values", "Every applicable option needs a value, using null when unknown.");
        }
    }

    public void analysis(JsonNode output, JsonNode decision, JsonNode option) {
        shape(output, "response", set("decisionId decisionVersion optionId status findings extractions limitations"), Set.of());
        binding(output, decision);
        generatedLanguage(output, "response", decision.path("originalInput").asText());
        require(output.path("optionId").equals(option.path("id")), "optionId", "Analysis belongs to a different option.");
        String status = one(output.path("status"), "status", Set.of("no_materials", "no_pressure_found", "needs_verification", "inconsistent"));
        Map<String, JsonNode> materials = indexed(option.path("materials"), "materials");
        array(output.path("findings"), "findings", 0, 40);
        indexed(output.path("findings"), "findings");
        boolean hasConflict = false, needsVerification = false;
        for (JsonNode finding : output.path("findings")) {
            shape(finding, "findings", set("id optionId materialIds quotes labels explanation needsVerification"), Set.of());
            require(finding.path("optionId").equals(option.path("id")), "findings.optionId", "Finding belongs to a different option.");
            strings(finding.path("materialIds"), "findings.materialIds", 10, 80);
            require(!finding.path("materialIds").isEmpty(), "findings.materialIds", "Finding needs evidence.");
            Set<String> refs = new HashSet<>();
            for (JsonNode ref : finding.path("materialIds")) require(materials.containsKey(ref.asText()) && refs.add(ref.asText()), "findings.materialIds", "Material references must exist and be unique.");
            array(finding.path("quotes"), "findings.quotes", 1, 20);
            Set<String> quoted = new HashSet<>();
            for (JsonNode quote : finding.path("quotes")) {
                shape(quote, "findings.quotes", set("materialId quote"), Set.of());
                String materialId = quote.path("materialId").asText();
                require(refs.contains(materialId), "findings.quotes.materialId", "Quote must reference a listed material.");
                evidence(quote.path("quote"), materials.get(materialId).path("text").asText(), "findings.quotes.quote");
                quoted.add(materialId);
            }
            require(quoted.equals(refs), "findings.quotes", "Each referenced material needs exact quoted evidence.");
            strings(finding.path("labels"), "findings.labels", 10, 40);
            require(!finding.path("labels").isEmpty(), "findings.labels", "At least one label is required.");
            Set<String> labels = new HashSet<>();
            for (JsonNode label : finding.path("labels")) { one(label, "findings.labels", LABELS); require(labels.add(label.asText()), "findings.labels", "Labels must be unique."); }
            text(finding.path("explanation"), "findings.explanation", 1, 2000);
            bool(finding.path("needsVerification"), "findings.needsVerification");
            if (labels.contains("conflict")) {
                require(quoted.size() >= 2, "findings.quotes", "Cross-material conflict requires evidence from at least two materials.");
                hasConflict = true;
            }
            needsVerification |= finding.path("needsVerification").asBoolean() || labels.stream().anyMatch(label -> !Set.of("normal_marketing", "disclosed").contains(label));
        }
        Pattern unmistakableUrgency = Pattern.compile("(?i)(?:\\blast day\\b|\\btoday only\\b|\\bonly today\\b|\\bends tonight\\b|仅限今天|仅限今日|最后一天)");
        for (JsonNode material : option.path("materials")) {
            if (!unmistakableUrgency.matcher(material.path("text").asText()).find()) continue;
            boolean covered = false;
            for (JsonNode finding : output.path("findings")) {
                boolean urgency = false;
                for (JsonNode label : finding.path("labels")) urgency |= label.asText().equals("urgency");
                if (!urgency) continue;
                for (JsonNode quote : finding.path("quotes")) covered |= quote.path("materialId").equals(material.path("id")) && unmistakableUrgency.matcher(quote.path("quote").asText()).find();
            }
            require(covered, "findings", "An explicit last-day or today-only urgency cue was omitted. Include its exact evidence and explain that urgency does not establish deception; applicable disclosed terms still matter.");
        }
        array(output.path("extractions"), "extractions", 0, 40);
        indexed(output.path("extractions"), "extractions");
        Map<String, JsonNode> costs = indexed(option.path("costs"), "costs");
        Map<String, JsonNode> factors = indexed(decision.path("factors"), "factors");
        for (JsonNode extraction : output.path("extractions")) {
            shape(extraction, "extractions", set("id optionId materialId quote label value unit costId factorId"), Set.of());
            require(extraction.path("optionId").equals(option.path("id")), "extractions.optionId", "Extraction belongs to a different option.");
            JsonNode material = materials.get(extraction.path("materialId").asText());
            require(material != null, "extractions.materialId", "Unknown material reference.");
            evidence(extraction.path("quote"), material.path("text").asText(), "extractions.quote");
            text(extraction.path("label"), "extractions.label", 1, 200);
            text(extraction.path("unit"), "extractions.unit", 0, 80);
            require(!extraction.path("value").isNull() && extraction.path("value").isValueNode(), "extractions.value", "Extraction requires a scalar value.");
            if (extraction.path("value").isNumber()) number(extraction.path("value"), "extractions.value", -MAX_SAFE, MAX_SAFE);
            require(extraction.path("costId").isNull() || extraction.path("factorId").isNull(), "extractions", "Target one cost or factor at a time.");
            if (!extraction.path("costId").isNull()) {
                require(costs.containsKey(extraction.path("costId").asText()), "extractions.costId", "Unknown cost reference.");
                integer(extraction.path("value"), "extractions.value", 0, MAX_SAFE);
                moneyEvidence(extraction.path("value"), extraction.path("quote").asText(), "extractions.value");
                require(extraction.path("unit").asText().equals(decision.path("currency").asText()), "extractions.unit", "Cost extraction must use the decision currency and integer minor units.");
            }
            if (!extraction.path("factorId").isNull()) {
                JsonNode factor = factors.get(extraction.path("factorId").asText());
                require(factor != null, "extractions.factorId", "Unknown factor reference.");
                boolean applies = false;
                for (JsonNode optionId : factor.path("optionIds")) applies |= optionId.equals(option.path("id"));
                require(applies, "extractions.factorId", "Factor is not applicable to this option.");
                scalar(extraction.path("value"), "extractions.value", factor.path("dataType").asText(), factor.path("allowedValues"));
                if (factor.path("dataType").asText().equals("money")) moneyEvidence(extraction.path("value"), extraction.path("quote").asText(), "extractions.value");
                require(extraction.path("unit").asText().equals(factor.path("unit").asText()), "extractions.unit", "Extraction unit must match the factor unit.");
                require(!factor.has("ruleId"), "extractions.factorId", "A calculated factor cannot be overwritten; extract its source cost instead.");
            }
        }
        strings(output.path("limitations"), "limitations", 12, 1500);
        String expected = materials.isEmpty() ? "no_materials" : hasConflict ? "inconsistent" : needsVerification ? "needs_verification" : "no_pressure_found";
        require(status.equals(expected), "status", "Expected evidence-based status: " + expected + ".");
        if (materials.isEmpty()) require(output.path("findings").isEmpty() && output.path("extractions").isEmpty(), "findings", "No materials cannot produce findings or extractions.");
    }

    public JsonNode option(JsonNode decision, JsonNode optionId) {
        id(optionId, "optionId");
        JsonNode option = indexed(decision.path("options"), "options").get(optionId.asText());
        require(option != null, "optionId", "Select an existing option.");
        return option;
    }

    private void value(JsonNode value, String path, String type, boolean generated, String input, Map<String, JsonNode> materials) {
        shape(value, path, set("value source note"), Set.of("materialId", "quote"));
        String source = one(value.path("source"), path + ".source", SOURCES);
        text(value.path("note"), path + ".note", 0, 2000);
        require(value.path("value").isNull() == source.equals("unknown"), path + ".source", "Unknown values use null and source=unknown; null is never zero.");
        if (!value.path("value").isNull()) scalar(value.path("value"), path + ".value", type, null);
        if (value.has("quote")) text(value.path("quote"), path + ".quote", 1, 4000);
        if (source.equals("material")) {
            JsonNode material = materials.get(value.path("materialId").asText());
            require(material != null, path + ".materialId", "Material source must belong to this option.");
            evidence(value.path("quote"), material.path("text").asText(), path + ".quote");
        } else require(!value.has("materialId"), path + ".materialId", "Only material sources may contain materialId.");
        if (generated) {
            require(!Set.of("demo", "user_edit").contains(source), path + ".source", "Live model output cannot claim demo data or user edits.");
            require(!source.equals("model_suggestion") || !value.path("value").isNumber(), path + ".value", "Suggested numeric assumptions must remain unknown until the user supplies them.");
            if (source.equals("user_input") || source.equals("derived")) {
                evidence(value.path("quote"), input, path + ".quote");
                if (type.equals("money")) moneyEvidence(value.path("value"), value.path("quote").asText(), path + ".value");
            }
            if (source.equals("derived")) require(!value.path("note").asText().isBlank(), path + ".note", "Derived values need a transparent unit-conversion explanation.");
        }
    }

    private static void moneyEvidence(JsonNode amount, String quote, String path) {
        Matcher numbers = Pattern.compile("(?<![0-9.])(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?").matcher(quote);
        boolean hasNumber = false, matches = false;
        boolean minorUnits = quote.toLowerCase(Locale.ROOT).matches("(?s).*(?:\\bcents?\\b|\\bpence\\b|\\bpennies\\b|[0-9]分(?!钟)).*");
        BigDecimal actual = amount.decimalValue();
        while (numbers.find()) {
            hasNumber = true;
            BigDecimal stated = new BigDecimal(numbers.group().replace(",", ""));
            BigDecimal canonical = minorUnits ? stated : stated.movePointRight(2);
            matches |= actual.compareTo(canonical) == 0;
        }
        // Word-form amounts still require exact evidence and user review; do not mistranslate them.
        require(!hasNumber || matches, path, "Money must match a number in the exact quote, converted to integer minor units (for example, 1200 CNY = 120000). Do not invent or amortize a price.");
    }

    static boolean hasWishLanguage(String quote) {
        return quote.toLowerCase(Locale.ROOT).matches("(?s).*(?:\\bwant\\b|\\bhope\\b|\\bwish\\b|\\bprefer\\b|would like|ideally|我想|希望|最好|倾向|更想|更喜欢).*");
    }

    static boolean hasExplicitRequirement(String quote) {
        return quote.toLowerCase(Locale.ROOT).matches("(?s).*(?:\\bmust\\b|\\brequired\\b|\\brequire\\b|\\bneed\\b|\\bneeds\\b|\\bcannot\\b|can't|have to|has to|mandatory|no more than|at most|at least|\\bmaximum\\b|\\bminimum\\b|not exceed|must not|必须|一定要|需要|不能|不得|不许|不超过|最多|至少|最低|最高|不多于).*");
    }

    private void requireExplicitCostPriority(JsonNode decision, String input) {
        Pattern explicit = Pattern.compile("(?i)(?:我首先考虑总(?:支出|费用|成本)|我最在意总(?:支出|费用|成本)|我的首要(?:偏好|目标|考虑)是总(?:支出|费用|成本)|my (?:first|top|primary) priority is (?:minimizing |the )?total (?:cost|spending|expenditure)|i care most about (?:minimizing |the )?total (?:cost|spending|expenditure))");
        Matcher stated = explicit.matcher(input);
        if (!stated.find()) return;
        // Limit this omission guard to an unequivocal current priority. Contrasting past/changed
        // preferences remain model interpretation and user review rather than a forced default.
        if (input.matches("(?is).*(?:previously|used to|no longer|以前|过去|不再|并非).*$")) return;
        String phrase = stated.group();
        String following = input.substring(stated.end()).stripLeading().replaceFirst("^[,，]\\s*", "");
        if (following.matches("(?is)^(?:还是|或者|或|但|or\\b|and\\b|but\\b|[?？]).*")) return;
        JsonNode selected = indexed(decision.path("factors"), "factors").get(decision.path("primaryFactorId").asText());
        require(selected != null && selected.path("ruleId").asText().equals("total_cost")
                        && selected.path("purpose").asText().equals("preference")
                        && selected.path("origin").asText().equals("user") && selected.path("confirmed").asBoolean()
                        && !selected.path("direction").asText().equals("none") && selected.path("userQuote").asText().contains(phrase),
                "primaryFactorId", "The user explicitly named total cost as the first priority. Preserve that selection: set primaryFactorId to a total_cost preference with origin=user, confirmed=true, a comparison direction and an exact userQuote containing the priority statement. Do not copy the skeleton's unconfirmed model suggestion or null primary.");
    }

    private static String computedRule(JsonNode factor) {
        String name = factor.path("name").asText().toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
        if (Set.of("totalcost", "totalexpenditure", "totalspending", "totalspend", "overallcost", "totalexpense", "totalexpenses").contains(name)) return "total_cost";
        if (Set.of("firstpayment", "initialpayment", "upfrontpayment", "upfrontcost", "initialoutlay").contains(name)) return "first_payment";
        if (Set.of("monthlycost", "monthlypayment", "recurringcost", "monthlyexpenditure").contains(name)) return "monthly_payment";
        if (Set.of("costperuse", "costpervisit", "costpersession", "costperlesson").contains(name)) return "cost_per_use";
        if (Set.of("totaltime", "totaltimecommitment").contains(name)) return "total_time";
        if (Set.of("monthlytime", "monthlytimecommitment").contains(name)) return "monthly_time";
        if (name.contains("budget") && !factor.path("dataType").asText().equals("text")) return factor.path("dataType").asText().equals("duration") ? "total_time" : "total_cost";
        return null;
    }

    private void generatedLanguage(JsonNode node, String path, String originalInput) {
        if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                // Values, category labels and targets may be original user data, not generated UI prose.
                if (!Set.of("originalInput", "quote", "userQuote", "value", "allowedValues", "desired").contains(entry.getKey())) generatedLanguage(entry.getValue(), path + "." + entry.getKey(), originalInput);
            });
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) generatedLanguage(node.get(i), path + "." + i, originalInput);
        } else if (node.isTextual()) {
            boolean originalOptionName = path.matches("decision\\.options\\.[0-9]+\\.name") && !node.asText().isBlank() && originalInput.contains(node.asText());
            require(originalOptionName || !node.asText().matches("(?s).*[\\p{IsHan}\\p{IsHiragana}\\p{IsKatakana}\\p{IsHangul}].*"), path,
                    "Display text must be English; preserve the original language only in source quotations and directly supplied user data.");
        }
    }

    static boolean explicitCompleteCosts(String input) {
        String lower = input.toLowerCase(Locale.ROOT);
        if (lower.matches("(?s).*(?:do not know|don't know|unknown|unclear|not sure|unsure|not confirmed|unconfirmed|不知道|不清楚|未知|未确认|不确定).{0,55}(?:fees|costs|charges|费用|收费).*")) return false;
        if (lower.matches("(?s).*(?:fees|costs|charges|费用|收费).{0,35}(?:unknown|unclear|not known|not confirmed|unconfirmed|不清楚|未知|未确认|不确定).*")) return false;
        if (lower.matches("(?s).*(?:if there are|whether there are|are there|if there is|是否|假如|如果).{0,35}(?:no (?:other|additional|extra|hidden) (?:fees|costs|charges)|无其他费用|没有其他费用|免费).*")) return false;
        return lower.matches("(?s).*(?:no (?:other|additional|extra|hidden) (?:fees|costs|charges)|(?:all|total) (?:costs|fees|charges) (?:are|is) (?:included|covered|known|listed)|(?:costs|fees|charges) are complete|all[- ]inclusive (?:price|fee|cost)|(?:is|are|both) free(?:[ .,!;]|$)|free of charge|没有其他费用|无其他费用|没有额外费用|无额外费用|无其他收费|全部费用已(?:包含|列出|确认)|所有费用已(?:包含|列出|确认)|费用已全部(?:包含|列出|确认)).*");
    }

    private void scalar(JsonNode value, String path, String type, JsonNode allowed) {
        switch (type) {
            case "money" -> integer(value, path, 0, MAX_SAFE);
            case "duration" -> number(value, path, 0, MAX_SAFE);
            case "number" -> number(value, path, -MAX_SAFE, MAX_SAFE);
            case "boolean" -> bool(value, path);
            case "date" -> { String date = text(value, path, 10, 10); try { LocalDate.parse(date); } catch (DateTimeParseException e) { fail(path, "Expected a valid ISO date (YYYY-MM-DD)."); } }
            default -> {
                text(value, path, 0, 4000);
                if (type.equals("category") && allowed != null && !allowed.isEmpty()) {
                    boolean found = false; for (JsonNode choice : allowed) found |= choice.equals(value);
                    require(found, path, "Category value must belong to allowedValues.");
                }
            }
        }
    }

    private void binding(JsonNode output, JsonNode decision) {
        require(output.path("decisionId").equals(decision.path("id")), "decisionId", "Response decision ID must match the request.");
        require(output.path("decisionVersion").equals(decision.path("version")), "decisionVersion", "Response version must match the request snapshot.");
    }
    private static String semanticKey(JsonNode factor) {
        return factor.has("ruleId") ? factor.path("ruleId").asText() + ":" + factor.path("purpose").asText() : factor.path("name").asText().toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }
    private static Map<String, JsonNode> indexed(JsonNode array, String path) {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        for (JsonNode node : array) { String id = id(node.path("id"), path + ".id"); require(result.put(id, node) == null, path + ".id", "IDs must be unique."); }
        return result;
    }
    private static Set<String> set(String fields) { return Set.of(fields.split(" ")); }
    private static void shape(JsonNode node, String path, Set<String> required, Set<String> optional) {
        require(node != null && node.isObject(), path, "Expected an object.");
        for (String field : required) require(node.has(field), path + "." + field, "Required field is missing.");
        node.fieldNames().forEachRemaining(field -> require(required.contains(field) || optional.contains(field), path + "." + field, "Unsupported field."));
    }
    private static String id(JsonNode node, String path) {
        String id = text(node, path, 1, 80);
        require(id.matches("[A-Za-z0-9][A-Za-z0-9_-]*"), path, "Use stable letters, numbers, underscores or hyphens for IDs.");
        return id;
    }
    private static String text(JsonNode node, String path, int min, int max) {
        require(node.isTextual() && node.asText().length() <= max && node.asText().trim().length() >= min, path, "Expected text with " + min + "–" + max + " characters.");
        return node.asText();
    }
    private static String one(JsonNode node, String path, Set<String> values) {
        require(node.isTextual() && values.contains(node.asText()), path, "Expected one of: " + String.join(", ", values) + "."); return node.asText();
    }
    private static void bool(JsonNode node, String path) { require(node.isBoolean(), path, "Expected true or false."); }
    private static void number(JsonNode node, String path, double min, double max) {
        require(node.isNumber() && Double.isFinite(node.doubleValue()) && node.doubleValue() >= min && node.doubleValue() <= max, path, "Expected a finite safe number from " + min + " to " + max + ".");
    }
    private static void integer(JsonNode node, String path, double min, double max) { number(node, path, min, max); require(node.doubleValue() == Math.rint(node.doubleValue()), path, "Expected an integer in canonical units."); }
    private static void array(JsonNode node, String path, int min, int max) { require(node.isArray() && node.size() >= min && node.size() <= max, path, "Expected an array with " + min + "–" + max + " entries."); }
    private static void strings(JsonNode node, String path, int max, int length) { array(node, path, 0, max); for (JsonNode item : node) text(item, path, 1, length); }
    private static void evidence(JsonNode quote, String input, String path) { String evidence = text(quote, path, 1, 4000); require(input.contains(evidence), path, "Quote must be an exact substring of the supplied source."); }
    private static void require(boolean condition, String path, String message) { if (!condition) fail(path, message); }
    private static void fail(String path, String message) { throw new ContractValidator.ContractException(path, message); }
}
