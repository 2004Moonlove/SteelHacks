package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ScenarioGenerationRegressionTest {
    private static final String INPUT = "Should I get a year-long gym membership or a monthly one";
    private final ObjectMapper mapper = new ObjectMapper();
    private final RecordingModel model = new RecordingModel();
    private final ContractValidator contract = new ContractValidator();
    private final GenerationService service = new GenerationService(model, mapper, contract,
            new StoryValidator(contract, new SimulationReconciler(contract, mapper)));

    @Test
    void recoversFromCapturedGymResponseWithoutInventingMissingValues() throws Exception {
        model.reply(fixture(), withoutFrequencyConversion());

        JsonNode decision = service.scenario("  " + INPUT + "  ");

        assertEquals(INPUT, decision.path("originalInput").asText());
        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("plain positive integer conversion factor"));
        assertTrue(model.requests.get(1).getLast().content().contains("Omit frequencyInput"));
        for (JsonNode option : decision.path("options")) {
            JsonNode price = option.path("fixedCosts").get(0).path("amountCentsMonthly");
            assertTrue(price.path("value").isNull());
            assertEquals("unknown", price.path("source").asText());
        }
        JsonNode missingDerivedCost = decision.path("tags").get(5).path("targets").get(0).path("costCentsMonthly");
        assertTrue(missingDerivedCost.path("value").isNull());
        assertEquals("unknown", missingDerivedCost.path("source").asText());
        contract.generatedDecision(decision);
    }

    @Test
    void preservesKnownNumbersAndConversionsWhileDowngradingOnlyMissingNumbers() throws Exception {
        JsonNode decision = fixture();
        for (JsonNode option : decision.path("options")) {
            ObjectNode activity = (ObjectNode) option.path("activities").get(0);
            ((ObjectNode) activity.path("frequencyInput")).put("eventsPerUnit", 1);
            ((ObjectNode) activity.path("eventsPerMonth")).put("value", 12).put("source", "user_input");
            ((ObjectNode) activity.path("minutesPerEvent")).put("source", "user_input");
        }
        ObjectNode fee = (ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly");
        fee.put("value", 5000).put("source", "derived");
        model.reply(decision);

        JsonNode result = service.scenario(INPUT + ". The annual plan is USD 600 per year and I visit 12 times per month.");

        assertEquals(1, model.requests.size());
        assertEquals(fee, result.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly"));
        for (JsonNode option : result.path("options")) {
            JsonNode activity = option.path("activities").get(0);
            assertEquals(1, activity.path("frequencyInput").path("eventsPerUnit").asInt());
            assertEquals(12, activity.path("eventsPerMonth").path("value").asInt());
            assertEquals("unknown", activity.path("minutesPerEvent").path("source").asText());
            assertTrue(activity.path("minutesPerEvent").path("value").isNull());
        }
    }

    @Test
    void clearsInventedKnownNumbersWhenTheQuestionSuppliesNoQuantity() throws Exception {
        JsonNode decision = withoutFrequencyConversion();
        ObjectNode fee = (ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly");
        fee.put("value", 5000).put("source", "user_input");
        model.reply(decision);

        JsonNode result = service.scenario("Should I buy a gym membership or pay per visit?");

        JsonNode resultFee = result.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly");
        assertTrue(resultFee.path("value").isNull());
        assertEquals("unknown", resultFee.path("source").asText());
        assertEquals(1, model.requests.size());
        contract.generatedDecision(result);
    }

    @ParameterizedTest
    @ValueSource(strings = {"user_edit", "demo_assumption", "invented"})
    void doesNotNormalizeDisallowedProvenance(String source) throws Exception {
        JsonNode decision = withoutFrequencyConversion();
        ObjectNode fee = (ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly");
        fee.put("source", source);
        model.reply(decision, decision);

        ApiException error = assertThrows(ApiException.class, () -> service.scenario(INPUT));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
    }

    @Test
    void doesNotAcceptAnUnknownFieldContainingANumber() throws Exception {
        JsonNode decision = withoutFrequencyConversion();
        ((ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly"))
                .put("value", 5000);
        model.reply(decision, decision);

        ApiException error = assertThrows(ApiException.class, () -> service.scenario(INPUT));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals("Unknown values must be null.", error.issues().get(0).message());
        assertEquals(2, model.requests.size());
    }

    @Test
    void includesAllowedUnitsInTheBoundedRepairRequest() throws Exception {
        JsonNode decision = withoutFrequencyConversion();
        JsonNode invalid = decision.deepCopy();
        ((ObjectNode) invalid.path("options").get(0).path("activities").get(0)).put("eventUnit", "visit");
        model.reply(invalid, decision);

        JsonNode result = service.scenario(INPUT);

        assertEquals("session", result.path("options").get(0).path("activities").get(0).path("eventUnit").asText());
        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("one_way_trip, meal, session, event"));
    }

    @Test
    void doesNotInventAnUnknownConversionFactor() throws Exception {
        JsonNode decision = fixture();
        model.reply(decision, decision);

        ApiException error = assertThrows(ApiException.class, () -> service.scenario(INPUT));

        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals("decision.options[0].activities[0].frequencyInput.eventsPerUnit", error.issues().get(0).path());
        assertEquals(2, model.requests.size());
    }

    private JsonNode fixture() throws Exception {
        try (var input = getClass().getResourceAsStream("/gym-generated-invalid.json")) {
            return mapper.readTree(input);
        }
    }

    private JsonNode withoutFrequencyConversion() throws Exception {
        JsonNode decision = fixture();
        for (JsonNode option : decision.path("options")) {
            ((ObjectNode) option.path("activities").get(0)).remove("frequencyInput");
        }
        return decision;
    }

    private final class RecordingModel implements ModelClient {
        private final ArrayDeque<String> responses = new ArrayDeque<>();
        private final List<List<Message>> requests = new ArrayList<>();

        void reply(JsonNode... decisions) throws Exception {
            for (JsonNode decision : decisions) responses.add(mapper.writeValueAsString(decision));
        }

        @Override
        public String complete(List<Message> messages) {
            requests.add(List.copyOf(messages));
            return responses.remove();
        }

        @Override
        public boolean configured() { return true; }
    }
}
