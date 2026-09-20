package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class GeneratedValueNormalizerTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void clearsInventedBaselineAndTagValuesForRawGymAndRelocationQuestions() throws Exception {
        for (String description : List.of(
                "Should I buy a gym membership or pay per visit?",
                "Should I relocate abroad with my company or stay local?")) {
            JsonNode decision = generatedValues();
            GeneratedValueNormalizer.normalize(decision, description);
            List<JsonNode> values = numericFields(decision);
            assertEquals(7, values.size());
            for (JsonNode value : values) {
                assertTrue(value.path("value").isNull());
                assertEquals("unknown", value.path("source").asText());
                assertEquals(GeneratedValueNormalizer.MISSING_INPUT_NOTE, value.path("note").asText());
            }
            assertEquals(2, decision.at("/options/0/activities/0/frequencyInput/eventsPerUnit").intValue());
        }
    }

    @Test
    void preservesDescriptionsWithPossibleNumericEvidence() throws Exception {
        for (String description : List.of(
                "Membership is $50 per month.", "Visit five times monthly.",
                "The visit takes one hundred and twenty-five minutes.", "Pay for a dozen visits.",
                "It takes half an hour.", "Use a quarter of the sessions.",
                "Visit once each week.", "Visit twice monthly.", "Visit thrice monthly.",
                "The fee is 1/2 the other price.", "Plan for Ⅳ visits.", "Plan for ½ hour.",
                "Plan for ٢ visits.", "Plan for １２ visits.", "每月三次健身。",
                "Membership has no monthly fees.", "Use the no-fee plan.",
                "Entry is free.", "Visits have no extra cost.", "Entry is without any additional charge.",
                "Complimentary admission is included.", "There is zero charge.")) {
            JsonNode decision = generatedValues();
            JsonNode original = decision.deepCopy();
            GeneratedValueNormalizer.normalize(decision, description);
            assertEquals(original, decision, description);
        }
    }

    @Test
    void preservesExplicitArticleUnitQuantities() throws Exception {
        for (String description : List.of(
                "A gym visit takes an hour. Should I buy a membership or pay per visit?",
                "The walk takes a minute.", "The pass costs a dollar.",
                "The fee is a hundred dollars.", "Each session takes an hour-long block.",
                "The trip takes an\u00a0hour.", "The course lasts a week.")) {
            JsonNode decision = generatedValues();
            JsonNode original = decision.deepCopy();
            GeneratedValueNormalizer.normalize(decision, description);
            assertEquals(original, decision, description);
            assertEquals(60, decision.at("/options/0/activities/0/minutesPerEvent/value").intValue());
        }
    }

    @Test
    void preservesOtherSourcesAndMalformedValuesForStrictValidation() throws Exception {
        JsonNode decision = mapper.readTree("""
                {"fields":[
                  {"value":12,"source":"user_edit","note":"User edit"},
                  {"value":12,"source":"demo_assumption","confirmed":false,"note":"Example"},
                  {"value":null,"source":"unknown","note":"Already missing"},
                  {"value":12,"source":"unknown"},
                  {"value":12,"source":"invented_source"},
                  {"value":"12","source":"user_input"},
                  {"value":true,"source":"derived"},
                  {"value":-1,"source":"derived"},
                  {"value":1.5,"source":"user_input"},
                  {"value":9007199254740992,"source":"derived"},
                  {"value":12,"source":"user_input","unexpected":"Keep for validation"},
                  {"value":12,"source":"user_input","note":""},
                  {"value":12,"source":"user_input","note":null},
                  {"value":12,"source":"user_input","confirmed":true},
                  {"value":{"amount":12},"source":"user_input"},
                  {"value":null,"source":"user_input"},
                  {"value":null,"source":"derived"}
                ],"eventsPerUnit":2,"simulationVersion":7}
                """);
        JsonNode original = decision.deepCopy();
        GeneratedValueNormalizer.normalize(decision, "Compare my gym options.");
        assertEquals(original, decision);
    }

    @Test
    void malformedKnownFieldsStillFailTheContractAfterNormalization() throws Exception {
        ContractValidator contract = new ContractValidator();
        for (String field : List.of(
                "{\"value\":-1,\"source\":\"derived\"}",
                "{\"value\":1.5,\"source\":\"derived\"}",
                "{\"value\":9007199254740992,\"source\":\"derived\"}",
                "{\"value\":\"12\",\"source\":\"derived\"}",
                "{\"value\":{},\"source\":\"derived\"}",
                "{\"value\":12,\"source\":\"derived\",\"extra\":true}",
                "{\"value\":12,\"source\":\"derived\",\"note\":\"\"}",
                "{\"value\":12,\"source\":\"derived\",\"note\":\"" + "x".repeat(5001) + "\"}")) {
            JsonNode value = mapper.readTree(field);
            GeneratedValueNormalizer.normalize(value, "Compare gym access.");
            assertThrows(ContractValidator.ContractException.class, () -> contract.numeric(value, "field"));
        }
    }

    @Test
    void replacesFalseProvenanceNotesForValidKnownFields() throws Exception {
        JsonNode decision = mapper.readTree("""
                {"value":0,"source":"derived","note":"The user confirmed no fee."}
                """);
        GeneratedValueNormalizer.normalize(decision, "Gym membership or pay per visit?");
        assertTrue(decision.path("value").isNull());
        assertEquals("unknown", decision.path("source").asText());
        assertEquals(GeneratedValueNormalizer.MISSING_INPUT_NOTE, decision.path("note").asText());
    }

    @Test
    void isIdempotentAndDoesNotTreatModelNotesAsUserEvidence() throws Exception {
        JsonNode decision = generatedValues();
        GeneratedValueNormalizer.normalize(decision, "Compare my gym options.");
        JsonNode normalized = decision.deepCopy();
        GeneratedValueNormalizer.normalize(decision, "Compare my gym options.");
        assertEquals(normalized, decision);
        assertTrue(decision.at("/options/0/fixedCosts/0/amountCentsMonthly/value").isNull());
    }

    private JsonNode generatedValues() throws Exception {
        return mapper.readTree("""
                {"options":[{
                  "fixedCosts":[{"amountCentsMonthly":{"value":5500,"source":"user_input","note":"The user supplied $55."}}],
                  "activities":[{
                    "frequencyInput":{"label":"Round trips","eventsPerUnit":2},
                    "eventsPerMonth":{"value":12,"source":"user_input"},
                    "costCentsPerEvent":{"value":0,"source":"derived","note":"Included in membership"},
                    "minutesPerEvent":{"value":60,"source":"derived"}
                  }]
                }],"tags":[{"targets":[{
                  "eventsPerMonth":{"value":4,"source":"user_input"},
                  "costCentsPerEvent":{"value":2500,"source":"derived"},
                  "minutesPerEvent":{"value":20,"source":"derived"}
                }]}]}
                """);
    }

    private List<JsonNode> numericFields(JsonNode node) {
        List<JsonNode> result = new ArrayList<>();
        if (node.isObject() && node.has("value") && node.has("source")) result.add(node);
        if (node.isContainerNode()) node.elements().forEachRemaining(child -> result.addAll(numericFields(child)));
        return result;
    }
}
