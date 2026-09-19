package app.dayfork;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ChoiceService {
    private final ModelClient model;
    private final ObjectMapper mapper;
    private final ChoiceValidator validator;

    public ChoiceService(ModelClient model, ObjectMapper mapper, ChoiceValidator validator) {
        this.model = model;
        this.mapper = mapper;
        this.validator = validator;
    }

    public JsonNode generate(JsonNode request) {
        String description = validatedRequest(() -> {
            validator.request(request, "description");
            return validator.input(request, "description", 8000);
        });
        return complete(ChoicePrompts.GENERATE, mapper.createObjectNode().put("description", description), output -> {
            if (output instanceof ObjectNode object) {
                object.put("originalInput", description);
                object.put("mode", "live");
                object.put("version", 1);
            }
            hydrateDecision(output);
            normalizeKnownSubscription(output, description);
            downgradeUnverifiableValues(output, description);
            removeModelMonthlyArithmetic(output);
            downgradeUnprovenFreeMoney(output);
            preserveIntentWithoutInventingOptionFacts(output);
            if (!ChoiceValidator.explicitCompleteCosts(description)) {
                for (JsonNode option : output.path("options")) {
                    if (option instanceof ObjectNode object && option.path("costsComplete").isBoolean()) object.put("costsComplete", false);
                }
            }
            validator.decision(output, true, description);
            removeExactBudgetDuplicate(output);
        });
    }

    public JsonNode factors(JsonNode request) {
        validatedRequest(() -> {
            validator.request(request, "decision", "instruction");
            validator.decision(request.path("decision"), false, "");
            validator.input(request, "instruction", 4000);
            return null;
        });
        return complete(ChoicePrompts.FACTORS, request, output -> {
            // Suggestions can only append reviewed factors and questions, never replace decision state.
            if (output instanceof ObjectNode object) object.retain("decisionId", "decisionVersion", "factors", "questions");
            hydrateFactors(output);
            downgradeUnverifiableValues(output, request.path("decision").path("originalInput").asText() + "\n" + request.path("instruction").asText());
            downgradeUnprovenFreeMoney(output);
            preserveIntentWithoutInventingOptionFacts(output);
            validator.suggestions(output, request.path("decision"), request.path("instruction").asText());
        });
    }

    public JsonNode materials(JsonNode request) {
        JsonNode option = validatedRequest(() -> {
            validator.request(request, "decision", "optionId");
            validator.decision(request.path("decision"), false, "");
            return validator.option(request.path("decision"), request.path("optionId"));
        });
        JsonNode decision = request.path("decision");
        if (option.path("materials").isEmpty()) {
            ObjectNode result = mapper.createObjectNode();
            result.set("decisionId", decision.path("id"));
            result.set("decisionVersion", decision.path("version"));
            result.set("optionId", option.path("id"));
            result.put("status", "no_materials");
            result.putArray("findings");
            result.putArray("extractions");
            result.putArray("limitations").add("No materials were provided. This is not a safety assessment.");
            return result;
        }
        // Keep context but omit other options' materials so they cannot be attributed to this option.
        ObjectNode modelRequest = request.deepCopy();
        for (JsonNode other : modelRequest.path("decision").path("options")) {
            if (!other.path("id").equals(option.path("id"))) ((ObjectNode) other).putArray("materials");
        }
        return complete(ChoicePrompts.MATERIALS, modelRequest, output -> {
            normalizeMaterialQuotes(output, option);
            validator.analysis(output, decision, option);
        });
    }

    private JsonNode complete(String prompt, JsonNode input, Consumer<JsonNode> validate) {
        String user = input.toString();
        String output = model.complete(List.of(new ModelClient.Message("system", prompt), new ModelClient.Message("user", user)));
        try {
            return parse(output, validate);
        } catch (ContractValidator.ContractException first) {
            // One semantic repair; transport retries and credential errors remain the existing provider client's responsibility.
            String repair = "Validation failed at " + first.path() + ": " + first.getMessage()
                    + " Return one complete corrected JSON object using the original evidence. Do not invent facts to pass validation. Audit the whole object, not only this field: every known user_input/derived value needs an exact original quote; absent frequency/time/horizon is null with source=unknown (never 0, 1 or a guessed default); annual fees use annual cadence; computed comparison factors need a verified ruleId and unknown values; use context.budgetCents or a money total_cost threshold for budget, never computed booleans; translate ALL display strings to English, including title, description, domain, decisionType, goals[].text, option names/descriptions, factor names/reasons/units/allowedValues, value notes, questions and assumptions (only originalInput/quote/userQuote may retain Chinese); include the complete required JSON shape, especially allowedValues, target with min/max/desired, values for all applicable options, context, materials, questions and assumptions; omit unused optional properties instead of null. Preserve every explicit user hard requirement.";
            String corrected = model.complete(List.of(new ModelClient.Message("system", prompt),
                    new ModelClient.Message("user", user),
                    new ModelClient.Message("assistant", output == null ? "" : output.substring(0, Math.min(output.length(), 100000))),
                    new ModelClient.Message("user", repair)));
            try {
                return parse(corrected, validate);
            } catch (ContractValidator.ContractException second) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "MODEL_OUTPUT_INVALID",
                        "The model response could not be verified. Your inputs are unchanged; please retry or continue manually.",
                        List.of(new ApiException.FieldIssue(second.path(), second.getMessage())));
            }
        }
    }

    private JsonNode parse(String output, Consumer<JsonNode> validate) {
        if (output == null || output.length() > 200000) throw new ContractValidator.ContractException("response", "Model response exceeds the allowed size.");
        try {
            JsonNode parsed = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(output);
            normalizeGeneratedShape(parsed);
            normalizeGeneratedFactors(parsed);
            validate.accept(parsed);
            return parsed;
        } catch (JsonProcessingException exception) {
            throw new ContractValidator.ContractException("response", "Response must be one valid JSON object.");
        }
    }

    private void preserveIntentWithoutInventingOptionFacts(JsonNode output) {
        for (JsonNode factor : output.path("factors")) {
            if (!(factor instanceof ObjectNode object)) continue;
            String userQuote = factor.path("userQuote").asText();
            if (factor.path("purpose").asText().equals("hard") && factor.path("origin").asText().equals("user")
                    && factor.path("confirmed").asBoolean() && ChoiceValidator.hasWishLanguage(userQuote)
                    && !ChoiceValidator.hasExplicitRequirement(userQuote)) {
                // Keep the user's desired outcome, but do not upgrade a wish to an exclusion rule.
                object.put("purpose", factor.path("dataType").asText().equals("text") ? "reference" : "preference");
                if (factor.path("dataType").asText().equals("text")) object.put("direction", "none");
            }
            if (!factor.path("dataType").asText().equals("boolean")) continue;
            for (JsonNode value : factor.path("values")) {
                if (!(value instanceof ObjectNode field) || !value.path("value").isBoolean()
                        || !List.of("user_input", "derived").contains(value.path("source").asText())) continue;
                String quote = value.path("quote").asText();
                boolean deferredAlternative = quote.toLowerCase(java.util.Locale.ROOT).matches("(?s).*(?:先不(?:选|买|购买|参加|报名)|暂(?:不|缓)|不报名|以后再(?:选|买|参加)|\\bdefer\\b|\\bpostpone\\b|not enroll|not buy|not take the course|skip this term).*");
                if (ChoiceValidator.hasWishLanguage(quote) || ChoiceValidator.hasExplicitRequirement(quote) || deferredAlternative) {
                    field.putNull("value").put("source", "unknown").put("note", "A wish, requirement or deferred alternative does not verify this option's actual properties. Confirm the option-specific fact.");
                    field.remove(List.of("quote", "materialId"));
                }
            }
        }
    }

    private void normalizeKnownSubscription(JsonNode decision, String input) {
        if (!(decision instanceof ObjectNode object) || !input.toLowerCase(java.util.Locale.ROOT).matches("(?s).*(?:\\bmembership\\b|\\bsubscription\\b|年卡|月卡|会员|订阅).*$")) return;
        boolean recurring = false, onlyRecurring = true;
        for (JsonNode option : decision.path("options")) for (JsonNode cost : option.path("costs")) {
            String cadence = cost.path("cadence").asText();
            recurring |= cadence.equals("annual") || cadence.equals("monthly");
            onlyRecurring &= cadence.equals("annual") || cadence.equals("monthly");
        }
        if (recurring && onlyRecurring) object.put("template", "subscription");
    }

    private void removeModelMonthlyArithmetic(JsonNode decision) {
        for (JsonNode option : decision.path("options")) {
            if (option instanceof ObjectNode object && option.path("minutesPerMonth").path("source").asText().equals("derived")) {
                object.set("minutesPerMonth", unknownValue("Additional fixed monthly time was not independently supplied. Usage time is calculated locally from frequency and time per use."));
            }
        }
    }

    private void downgradeUnprovenFreeMoney(JsonNode decision) {
        unprovenZero(decision.path("context").path("budgetCents"));
        for (JsonNode option : decision.path("options")) for (JsonNode cost : option.path("costs")) unprovenZero(cost.path("amount"));
        for (JsonNode factor : decision.path("factors")) {
            if (factor.path("dataType").asText().equals("money")) for (JsonNode value : factor.path("values")) unprovenZero(value);
        }
    }

    private void unprovenZero(JsonNode value) {
        if (!(value instanceof ObjectNode object) || !value.path("value").isNumber() || value.path("value").doubleValue() != 0
                || !List.of("user_input", "derived").contains(value.path("source").asText())) return;
        String quote = value.path("quote").asText().toLowerCase(java.util.Locale.ROOT);
        boolean zero = quote.matches("(?s).*(?<![0-9.])0(?:\\.0+)?(?![0-9.]).*")
                || quote.matches("(?s).*(?:\\bzero\\b|\\bfree\\b|no charge|no cost|no other fees|without charge|零|免费|不收费|无费用|无需支付|无需付款).*");
        boolean negated = quote.matches("(?s).*(?:not free|isn't free|is not free|不是免费|并非免费|不免费).*");
        if (!zero || negated) {
            object.putNull("value").put("source", "unknown").put("note", "No explicit zero-price or free-service evidence was supplied. Deferring alone does not establish zero cost.");
            object.remove(List.of("quote", "materialId"));
        }
    }

    private void removeExactBudgetDuplicate(JsonNode decision) {
        JsonNode budget = decision.path("context").path("budgetCents");
        if (!budget.path("value").isNumber() || !List.of("user_input", "derived").contains(budget.path("source").asText())
                || budget.path("quote").asText().isBlank() || !(decision.path("factors") instanceof com.fasterxml.jackson.databind.node.ArrayNode factors)) return;
        Set<String> allOptions = new HashSet<>();
        for (JsonNode option : decision.path("options")) allOptions.add(option.path("id").asText());
        for (int i = factors.size() - 1; i >= 0; i--) {
            JsonNode factor = factors.get(i), target = factor.path("target");
            Set<String> applicability = new HashSet<>();
            for (JsonNode optionId : factor.path("optionIds")) applicability.add(optionId.asText());
            if (factor.path("purpose").asText().equals("hard") && factor.path("origin").asText().equals("user") && factor.path("confirmed").asBoolean()
                    && factor.path("dataType").asText().equals("money") && factor.path("unit").equals(decision.path("currency"))
                    && factor.path("ruleId").asText().equals("total_cost") && target.path("min").isNull() && target.path("desired").isNull()
                    && target.path("max").isNumber() && target.path("max").decimalValue().compareTo(budget.path("value").decimalValue()) == 0
                    && factor.path("userQuote").equals(budget.path("quote")) && applicability.equals(allOptions)) {
                // One explicit common budget has one mutable source. Preserve every distinct amount,
                // source statement, option-specific threshold, lower bound or other requirement.
                factors.remove(i);
            }
        }
    }

    private void normalizeMaterialQuotes(JsonNode output, JsonNode option) {
        for (JsonNode finding : output.path("findings")) for (JsonNode quote : finding.path("quotes")) mapExactQuote(quote, option);
        for (JsonNode extraction : output.path("extractions")) mapExactQuote(extraction, option);
    }

    private void mapExactQuote(JsonNode quoteNode, JsonNode option) {
        if (!(quoteNode instanceof ObjectNode quote) || !quote.path("quote").isTextual()) return;
        for (JsonNode material : option.path("materials")) {
            if (!material.path("id").equals(quote.path("materialId"))) continue;
            String original = material.path("text").asText();
            String selected = quote.path("quote").asText();
            if (original.contains(selected)) return;
            NormalizedText source = normalizedWhitespace(original), evidence = normalizedWhitespace(selected);
            if (evidence.text().isEmpty()) return;
            int start = source.text().indexOf(evidence.text());
            if (start >= 0) {
                // Map whitespace-only variation back to an exact original substring. Never paraphrase,
                // alter punctuation/case, concatenate fragments or borrow another material's evidence.
                quote.put("quote", original.substring(source.starts().get(start), source.ends().get(start + evidence.text().length() - 1)));
            }
            return;
        }
    }

    private record NormalizedText(String text, List<Integer> starts, List<Integer> ends) {}

    private NormalizedText normalizedWhitespace(String text) {
        StringBuilder normalized = new StringBuilder();
        List<Integer> starts = new ArrayList<>(), ends = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            char character = text.charAt(i);
            boolean whitespace = Character.isWhitespace(character) || Character.isSpaceChar(character);
            if (whitespace && normalized.isEmpty()) continue;
            if (whitespace && normalized.charAt(normalized.length() - 1) == ' ') {
                ends.set(ends.size() - 1, i + 1);
            } else {
                normalized.append(whitespace ? ' ' : character); starts.add(i); ends.add(i + 1);
            }
        }
        if (!normalized.isEmpty() && normalized.charAt(normalized.length() - 1) == ' ') {
            normalized.deleteCharAt(normalized.length() - 1); starts.remove(starts.size() - 1); ends.remove(ends.size() - 1);
        }
        return new NormalizedText(normalized.toString(), starts, ends);
    }

    private ObjectNode unknownValue(String note) {
        return mapper.createObjectNode().putNull("value").put("source", "unknown").put("note", note);
    }

    private void hydrateDecision(JsonNode output) {
        if (!(output instanceof ObjectNode decision)) return;
        if (!decision.has("context")) decision.putObject("context");
        if (decision.path("context") instanceof ObjectNode context) {
            for (String field : List.of("months", "usesPerMonth", "budgetCents")) {
                if (!context.has(field)) context.set(field, unknownValue("Not supplied in the model response. Please confirm."));
            }
        }
        for (String field : List.of("questions", "assumptions")) if (!decision.has(field)) decision.putArray(field);
        if (!decision.has("primaryFactorId")) decision.putNull("primaryFactorId");
        for (JsonNode option : decision.path("options")) {
            if (!(option instanceof ObjectNode object)) continue;
            for (String field : List.of("materials", "costs")) if (!object.has(field)) object.putArray(field);
            if (!object.has("costsComplete")) object.put("costsComplete", false);
            for (String field : List.of("minutesPerUse", "minutesPerMonth")) {
                if (!object.has(field)) object.set(field, unknownValue("Time was not supplied. Please confirm."));
            }
            for (JsonNode cost : object.path("costs")) {
                if (cost instanceof ObjectNode item && !item.has("amount")) item.set("amount", unknownValue("Price was not supplied. Please confirm."));
            }
        }
        hydrateFactors(decision);
    }

    private void hydrateFactors(JsonNode output) {
        for (JsonNode factor : output.path("factors")) {
            if (!(factor instanceof ObjectNode object)) continue;
            if (!object.has("allowedValues")) object.putArray("allowedValues");
            if (!object.has("target")) object.putObject("target");
            if (object.path("target") instanceof ObjectNode target) {
                for (String field : List.of("min", "max", "desired")) if (!target.has(field)) target.putNull(field);
            }
            if (!object.has("values")) object.putObject("values");
            if (object.path("values") instanceof ObjectNode values) {
                for (JsonNode optionId : object.path("optionIds")) {
                    if (optionId.isTextual() && !values.has(optionId.asText())) values.set(optionId.asText(), unknownValue("Not supplied for this option. Please confirm."));
                }
            }
        }
    }

    private void downgradeUnverifiableValues(JsonNode node, String input) {
        if (node instanceof ObjectNode object) {
            String source = object.path("source").asText();
            if (object.has("value") && !object.path("value").isNull() && List.of("user_input", "derived").contains(source)) {
                String quote = object.path("quote").asText();
                if (quote.isBlank() || !input.contains(quote)) {
                    object.putNull("value").put("source", "unknown").put("note", "The model did not supply verifiable evidence. Confirm this value before comparing.");
                    object.remove(List.of("quote", "materialId"));
                }
            }
            object.elements().forEachRemaining(child -> downgradeUnverifiableValues(child, input));
        } else if (node != null && node.isArray()) node.elements().forEachRemaining(child -> downgradeUnverifiableValues(child, input));
    }

    private void normalizeGeneratedShape(JsonNode node) {
        if (node instanceof ObjectNode object) {
            if (object.has("value") && object.has("source")) {
                if (!object.has("note")) object.put("note", "");
                if (object.path("note").isTextual() && object.path("note").asText().matches("(?s).*[\\p{IsHan}\\p{IsHiragana}\\p{IsKatakana}\\p{IsHangul}].*")) {
                    object.put("note", object.path("value").isNull() ? "Not verified. Please confirm this value." : "Review the cited source and confirm this value.");
                }
                if (object.path("value").isNull() && List.of("user_input", "derived", "model_suggestion").contains(object.path("source").asText())) object.put("source", "unknown");
                for (String optional : List.of("quote", "materialId")) if (object.path(optional).isNull()) object.remove(optional);
            }
            if (object.has("dataType") && object.has("optionIds")) {
                for (String optional : List.of("ruleId", "userQuote")) if (object.path(optional).isNull()) object.remove(optional);
            }
            object.elements().forEachRemaining(this::normalizeGeneratedShape);
        } else if (node != null && node.isArray()) node.elements().forEachRemaining(this::normalizeGeneratedShape);
    }

    private void normalizeGeneratedFactors(JsonNode output) {
        if (output == null) return;
        // Computed values are supplied exclusively by the deterministic engine. Discard model totals;
        // never change primary input costs, dates, targets, or source quotes to make a response pass.
        for (JsonNode factor : output.path("factors")) {
            for (JsonNode value : factor.path("values")) {
                if (value instanceof ObjectNode object && (factor.has("ruleId") || value.path("source").asText().equals("derived"))) {
                    object.putNull("value").put("source", "unknown").put("note", factor.has("ruleId")
                            ? "Calculated locally from current decision inputs."
                            : "Model-calculated values are not accepted as facts. Confirm the underlying information.");
                    object.remove(List.of("quote", "materialId"));
                }
            }
        }
    }

    private <T> T validatedRequest(Supplier<T> operation) {
        try {
            return operation.get();
        } catch (ContractValidator.ContractException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Please correct the decision inputs.",
                    List.of(new ApiException.FieldIssue(exception.path(), exception.getMessage())));
        }
    }
}
