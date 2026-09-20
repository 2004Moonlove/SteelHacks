package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.regex.Pattern;

/**
 * A negative-evidence guard, not a general proof of numeric provenance.
 * When any possible quantity is present, the model's ordinary contract validation
 * remains responsible for the response; matching a word does not validate a value.
 */
public final class GeneratedValueNormalizer {
    private static final Pattern NUMERIC_EVIDENCE = Pattern.compile(
            "\\p{N}|[〇零一二三四五六七八九十百千万億亿兆兩两廿卅卌]"
            + "|\\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
            + "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|"
            + "forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|"
            + "trillion|quadrillion|first|second|third|fourth|fifth|sixth|seventh|eighth|"
            + "ninth|tenth|half|halves|quarter|quarters|thirds|fourths|fifths|sixths|"
            + "sevenths|eighths|ninths|tenths|once|twice|thrice|single|double|triple|"
            + "dozen|dozens|couple|pair|nil|nought|free|complimentary)\\b"
            + "|\\b(?:a|an)[\\p{Z}\\s]+(?:second|minute|hour|day|week|fortnight|month|year|"
            + "cent|dollar|euro|pound|yen|yuan|rupee|peso|buck|grand)\\b"
            + "|\\b(?:no|without)\\b[^.!?;\\n]{0,40}\\b(?:fees?|costs?|charges?)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    static final String MISSING_INPUT_NOTE = "No numeric value was supplied; enter this value to continue.";

    private GeneratedValueNormalizer() {}

    public static void normalize(JsonNode decision, String description) {
        if (NUMERIC_EVIDENCE.matcher(description == null ? "" : description).find()) return;
        clearUnsupportedKnownValues(decision);
    }

    private static boolean isValidKnownField(ObjectNode object) {
        String source = object.path("source").asText();
        if (!source.equals("user_input") && !source.equals("derived")) return false;
        if (object.size() != (object.has("note") ? 3 : 2)) return false;
        JsonNode value = object.path("value");
        if (!value.isIntegralNumber() || !value.canConvertToLong()
                || value.longValue() < 0 || value.longValue() > MAX_SAFE_INTEGER) return false;
        JsonNode note = object.path("note");
        return !object.has("note") || (note.isTextual() && !note.asText().isBlank()
                && note.asText().length() <= ContractValidator.MAX_TEXT_LENGTH);
    }

    private static void clearUnsupportedKnownValues(JsonNode node) {
        if (node instanceof ObjectNode object) {
            if (isValidKnownField(object)) {
                object.putNull("value");
                object.put("source", "unknown");
                object.put("note", MISSING_INPUT_NOTE);
            }
            object.elements().forEachRemaining(GeneratedValueNormalizer::clearUnsupportedKnownValues);
        } else if (node != null && node.isArray()) {
            node.elements().forEachRemaining(GeneratedValueNormalizer::clearUnsupportedKnownValues);
        }
    }
}
