package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class ChoiceValidator {
    private final Map<String, JsonSchema> schemas = new HashMap<>();
    private final Map<String, String> contracts = new HashMap<>();
    public ChoiceValidator(ObjectMapper mapper) throws IOException {
        for (String name : List.of("decision", "factors", "analysis")) {
            try (var stream = getClass().getResourceAsStream("/choice-" + name + ".schema.json")) {
                JsonNode schema = mapper.readTree(stream);
                contracts.put(name, schema.toString());
                schemas.put(name, JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(schema));
            }
        }
    }
    public String contract(String name) { return contracts.get(name); }
    void require(boolean condition, String message) { if (!condition) throw new IllegalArgumentException(message); }
    void shape(String name, JsonNode value) {
        require(value != null, "Response is missing.");
        var errors = schemas.get(name).validate(value);
        // Do not echo values, quoted user content, or model output into API errors or logs.
        require(errors.isEmpty(), "JSON does not match the " + name + " contract: " + errors.stream().limit(5).map(e -> e.getInstanceLocation() + " " + e.getType()).toList());
    }
    public void decision(JsonNode d) {
        shape("decision", d);
        Set<String> optionIds = new HashSet<>(), factorIds = new HashSet<>(), materials = new HashSet<>(), rules = new HashSet<>();
        for (JsonNode o : d.path("options")) {
            require(optionIds.add(o.path("id").asText()), "Duplicate option IDs.");
            for (JsonNode m : o.path("materials")) require(materials.add(m.path("id").asText()), "Duplicate material IDs.");
        }
        for (JsonNode f : d.path("factors")) {
            require(factorIds.add(f.path("id").asText()), "Duplicate factor IDs.");
            Set<String> targets = new HashSet<>();
            String type = f.path("dataType").asText(), rule = f.path("ruleId").asText("");
            if (!rule.isEmpty()) {
                String expected = rule.contains("time") ? "duration" : rule.contains("months") ? "number" : "money";
                require(type.equals(expected), "Rule has an incompatible data type.");
                require(f.path("unit").asText().equals(expected.equals("money") ? d.path("currency").asText() : expected.equals("duration") ? "min" : "months"), "Rule has an incompatible unit.");
            }
            if (f.path("target").has("min") && f.path("target").has("max")) require(f.path("target").path("min").asDouble() <= f.path("target").path("max").asDouble(), "Minimum exceeds maximum.");
            JsonNode target = f.path("target").path("equals");
            if (!target.isMissingNode() && !target.isNull()) {
                require(switch (type) {
                    case "number", "money", "duration" -> target.isNumber();
                    case "boolean" -> target.isBoolean();
                    default -> target.isTextual();
                }, "Target type does not match its factor.");
                if (type.equals("money")) require(target.asDouble() == Math.rint(target.asDouble()), "Money targets must use integer cents.");
                if (type.equals("date")) { try { require(LocalDate.parse(target.asText()).toString().equals(target.asText()), "Invalid target date."); } catch (RuntimeException e) { throw new IllegalArgumentException("Invalid target date."); } }
            }
            if (f.path("target").has("min") || f.path("target").has("max")) require(List.of("number", "money", "duration").contains(type), "Numeric ranges require a numeric factor.");
            for (JsonNode oid : f.path("optionIds")) {
                String optionId = oid.asText();
                require(optionIds.contains(optionId) && targets.add(optionId), "Invalid factor option reference.");
                JsonNode field = f.path("values").path(optionId), value = field.path("value");
                require(!field.isMissingNode(), "Missing option value entry.");
                if (f.path("confirmed").asBoolean() && !rule.isEmpty()) require(rules.add(optionId + ":" + rule), "Duplicate calculation rules.");
                if (!value.isNull()) {
                    require(!field.path("source").path("kind").asText().equals("unknown"), "Unknown sources cannot contain values.");
                    require(switch (type) {
                        case "number", "money", "duration" -> value.isNumber();
                        case "boolean" -> value.isBoolean();
                        default -> value.isTextual();
                    }, "Value does not match factor data type.");
                    if (type.equals("money")) require(value.asDouble() == Math.rint(value.asDouble()), "Money must use integer cents.");
                    if (type.equals("date")) { try { require(LocalDate.parse(value.asText()).toString().equals(value.asText()), "Invalid date."); } catch (RuntimeException e) { throw new IllegalArgumentException("Invalid calendar date."); } }
                    if (type.equals("category") && !f.path("allowedValues").isEmpty()) require(contains(f.path("allowedValues"), value), "Category is not in the allowed list.");
                    if (!rule.isEmpty()) require(value.asDouble() >= 0 && (!rule.contains("months") || value.asDouble() == Math.rint(value.asDouble())) && (!rule.equals("billing_months") || value.asDouble() >= 1), "Invalid calculation value.");
                }
            }
            f.path("values").fieldNames().forEachRemaining(key -> require(targets.contains(key), "Unexpected value option reference."));
            require(!(List.of("boolean", "text").contains(type) && List.of("higher", "lower").contains(f.path("direction").asText())), "Use an explicit target for this data type.");
        }
        if (!d.path("primaryFactorId").isNull()) {
            JsonNode primary = find(d.path("factors"), d.path("primaryFactorId").asText());
            require(primary != null && primary.path("confirmed").asBoolean() && primary.path("purpose").asText().equals("preference"), "Primary preference must be confirmed.");
        }
    }
    // These checks apply only to model-generated decisions, not to editable or general reference factors.
    // Recognized housing payment/trip evidence is deliberately narrow; this is not a full natural-language proof.
    void generatedDecision(JsonNode d) {
        boolean housing = matches(d.path("domain").asText(), "\\b(housing|rental|accommodation)\\b");
        for (JsonNode f : d.path("factors")) {
            String rule = f.path("ruleId").asText("");
            for (JsonNode oid : f.path("optionIds")) {
                String optionId = oid.asText();
                JsonNode field = f.path("values").path(optionId);
                String quote = field.path("source").path("quote").asText();
                if (housing && !field.path("value").isNull()) {
                    boolean payment = f.path("dataType").asText().equals("money")
                        && !List.of("upfront", "per_use").contains(rule)
                        && !matches(f.path("name").asText(), "\\b(upfront|deposit|security|average|median|benchmark|resale)\\b")
                        && matches(f.path("name").asText(), "\\b(rent|rental|housing cost|housing payment|monthly cost|annual cost|total cost)\\b")
                        && matches(quote, "\\b(rent|rents|rental|housing)\\b")
                        && matches(quote, "\\b(monthly|annually|yearly|per month|per year|each month|each year|a month|a year)\\b");
                    if (payment) {
                        require(rule.equals("recurring"), "Housing payments need recurring with the original per-billing-period amount and billing_months; do not replace inputs with computed horizon totals.");
                        require(quotedPaymentAmount(field, d.path("currency").asText()), "A recurring housing payment must preserve an explicitly quoted payment amount, not a computed horizon total. Keep the original payment in cents and its billing_months.");
                    }
                    boolean trip = f.path("dataType").asText().equals("duration")
                        && matches(f.path("name").asText(), "\\b(commute|commuting|travel)\\b")
                        && matches(quote, "\\b(commute|commuting|travel)\\b")
                        && matches(quote, "\\b(one[- ]way|per trip|per commute|each trip|each commute)\\b");
                    if (trip) require(rule.equals("time_per_use"), "A quoted one-way or per-trip commute duration needs time_per_use, with the matching trip frequency in usesPerWeek; do not return an unmapped or computed total-time factor.");
                }
                if (rule.equals("recurring")) {
                    boolean billing = false;
                    for (JsonNode candidate : d.path("factors")) {
                        if (candidate.path("ruleId").asText().equals("billing_months") && contains(candidate.path("optionIds"), oid)) billing = true;
                    }
                    require(billing, "Every recurring payment needs a billing_months factor for the same option. Use the stated billing interval or an unknown value; never invent it.");
                }
            }
        }
    }
    private boolean matches(String text, String pattern) {
        return Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(text.toLowerCase(Locale.ROOT).replaceAll("[\\p{Pd}\\u2212]", "-")).find();
    }
    private boolean quotedPaymentAmount(JsonNode field, String currency) {
        String prefix = switch (currency) { case "CNY" -> "[¥￥]|CNY|RMB"; case "EUR" -> "€|EUR"; case "GBP" -> "£|GBP"; default -> "\\$|USD"; };
        String suffix = switch (currency) { case "CNY" -> "CNY|RMB|yuan"; case "EUR" -> "EUR|euros?"; case "GBP" -> "GBP|pounds?"; default -> "USD|(?:US )?dollars?"; };
        String amount = "([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)";
        var amounts = Pattern.compile("(?:(?:" + prefix + ")\\s*" + amount + "|" + amount + "\\s*(?:" + suffix + ")\\b)", Pattern.CASE_INSENSITIVE).matcher(field.path("source").path("quote").asText());
        boolean recognizedAmount = false;
        while (amounts.find()) {
            recognizedAmount = true;
            String raw = amounts.group(1) == null ? amounts.group(2) : amounts.group(1);
            BigDecimal cents = new BigDecimal(raw.replace(",", "")).movePointRight(2);
            if (cents.compareTo(field.path("value").decimalValue()) == 0) return true;
        }
        // Unsupported amount spellings stay subject to the existing grounding check and user review.
        return !recognizedAmount;
    }
    private boolean contains(JsonNode values, JsonNode target) { for (JsonNode value : values) if (value.equals(target)) return true; return false; }
    JsonNode find(JsonNode list, String id) { for (JsonNode value : list) if (value.path("id").asText().equals(id)) return value; return null; }
    public void factors(JsonNode response, JsonNode d) {
        shape("factors", response); version(response, d);
        ObjectNode proposed = d.deepCopy();
        proposed.set("factors", response.path("factors")); proposed.putNull("primaryFactorId");
        decision(proposed);
    }
    void version(JsonNode response, JsonNode d) {
        require(response.path("decisionId").asText().equals(d.path("id").asText()) && response.path("version").asInt(-1) == d.path("version").asInt(), "Response version does not match the decision.");
    }
    public void analysis(JsonNode response, JsonNode d, String optionId) {
        shape("analysis", response); version(response, d);
        require(response.path("optionId").asText().equals(optionId), "Analysis option does not match.");
        JsonNode option = find(d.path("options"), optionId);
        require(option != null && !option.path("materials").isEmpty(), "No materials provided for this option.");
        Set<String> findings = new HashSet<>(); boolean conflict = false, concern = false;
        for (JsonNode finding : response.path("findings")) {
            require(findings.add(finding.path("id").asText()), "Duplicate finding IDs.");
            Set<String> evidenceMaterials = new HashSet<>();
            for (JsonNode evidence : finding.path("evidence")) { evidence(evidence, option); evidenceMaterials.add(evidence.path("materialId").asText()); }
            for (JsonNode tag : finding.path("tags")) {
                if (tag.asText().equals("conflict")) { conflict = true; require(evidenceMaterials.size() >= 2, "Cross-material conflicts need evidence from two materials."); }
                if (!List.of("normal_marketing", "clear_disclosure").contains(tag.asText())) concern = true;
            }
        }
        require(response.path("status").asText().equals(conflict ? "inconsistent" : concern || !response.path("extracted").isEmpty() ? "needs_verification" : "no_pressure"), "Analysis status does not agree with its findings.");
        for (JsonNode value : response.path("extracted")) {
            evidence(value, option);
            JsonNode factor = find(d.path("factors"), value.path("factorId").asText());
            require(factor != null && factor.path("values").has(optionId), "Extracted value references an invalid factor.");
            require(value.path("unit").equals(factor.path("unit")), "Extracted unit does not match.");
            ObjectNode trial = d.deepCopy();
            ObjectNode field = (ObjectNode) find(trial.path("factors"), value.path("factorId").asText()).path("values").path(optionId);
            field.set("value", value.path("value")); ((ObjectNode) field.path("source")).put("kind", "material");
            decision(trial);
        }
    }
    private void evidence(JsonNode evidence, JsonNode option) {
        JsonNode material = find(option.path("materials"), evidence.path("materialId").asText());
        require(material != null && material.path("text").asText().contains(evidence.path("quote").asText()), "Evidence must exactly quote a provided material for this option.");
    }
}

