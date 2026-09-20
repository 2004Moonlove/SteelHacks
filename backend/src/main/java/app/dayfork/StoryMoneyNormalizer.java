package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Restores references for unambiguous, already validated dollar facts without creating new amounts. */
final class StoryMoneyNormalizer {
    private static final Pattern MONEY_FACT = Pattern.compile(
            "(?:option[AB]_(?:payment|totalCost|monthlyCost|dayTravelCost|upfrontCost|perUseCost)|monthlyCostDifference)");
    private static final Pattern DOLLAR = Pattern.compile(
            "(?<![\\p{L}\\p{N}_$+\\-])\\$(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+)(?:\\.[0-9]{1,2})?"
            + "(?![\\p{L}\\p{N}_%]|[.,][0-9])");

    private StoryMoneyNormalizer() {}

    static JsonNode normalize(JsonNode story, JsonNode validatedFacts) {
        Map<BigInteger, String> references = new HashMap<>();
        Set<BigInteger> ambiguous = new HashSet<>();
        validatedFacts.fields().forEachRemaining(entry -> {
            if (!MONEY_FACT.matcher(entry.getKey()).matches() || !entry.getValue().isTextual()) return;
            String value = entry.getValue().asText();
            if (!DOLLAR.matcher(value).matches()) return;
            BigInteger cents = cents(value);
            if (references.putIfAbsent(cents, entry.getKey()) != null) ambiguous.add(cents);
        });
        ambiguous.forEach(references::remove);
        if (references.isEmpty() || !(story instanceof ObjectNode)) return story;
        ObjectNode result = story.deepCopy();
        normalizeField(result.path("sharedScenario"), "title", references);
        normalizeField(result.path("sharedScenario"), "description", references);
        for (JsonNode moment : result.path("moments")) {
            for (JsonNode option : moment.path("options")) normalizeField(option, "text", references);
        }
        for (String field : new String[]{"monthlyReflections", "advice"}) {
            for (JsonNode option : result.path(field)) normalizeField(option, "text", references);
        }
        return result;
    }

    private static void normalizeField(JsonNode container, String field, Map<BigInteger, String> references) {
        if (!(container instanceof ObjectNode object) || !object.path(field).isTextual()) return;
        Matcher matcher = DOLLAR.matcher(object.path(field).asText());
        StringBuffer normalized = new StringBuffer();
        while (matcher.find()) {
            String fact = references.get(cents(matcher.group()));
            matcher.appendReplacement(normalized, Matcher.quoteReplacement(fact == null ? matcher.group() : "{{" + fact + "}}"));
        }
        matcher.appendTail(normalized);
        object.put(field, normalized.toString());
    }

    private static BigInteger cents(String dollars) {
        return new BigDecimal(dollars.substring(1).replace(",", "")).movePointRight(2).toBigIntegerExact();
    }
}
