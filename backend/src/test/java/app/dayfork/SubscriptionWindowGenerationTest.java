package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class SubscriptionWindowGenerationTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract,
            new StoryValidator(contract, new SimulationReconciler(contract, mapper)));

    @Test
    void repairsTheLiveOmittedWindowEvenWhenTitleAndDescriptionMentionIt() throws Exception {
        ObjectNode omitted = fixture();
        ObjectNode corrected = omitted.deepCopy().put("comparisonMonths", 13);
        assertFalse(omitted.has("comparisonMonths"));
        assertTrue(omitted.path("title").asText().contains("13"));
        contract.decision(omitted); // Existing saved decisions keep their editable default-window compatibility.
        model.reply(omitted, corrected);
        JsonNode result = service.scenario(omitted.path("originalInput").asText());
        assertEquals(13, result.path("comparisonMonths").asInt());
        assertEquals(omitted.path("options"), result.path("options"));
        assertEquals(60000, result.path("options").get(0).path("subscriptionCosts").path("paymentCents").path("value").asInt());
        assertEquals(12, result.path("options").get(0).path("subscriptionCosts").path("periodMonths").asInt());
        assertEquals(6000, result.path("options").get(1).path("subscriptionCosts").path("paymentCents").path("value").asInt());
        assertEquals(1, result.path("options").get(1).path("subscriptionCosts").path("periodMonths").asInt());
        assertEquals(2, model.requests.size());
        String repair = model.requests.get(1).getLast().content();
        assertTrue(repair.contains("comparisonMonths: 13 exactly"));
        assertTrue(repair.contains("Preserve the supplied payment amounts and billing periods"));
        assertTrue(model.requests.getFirst().getFirst().content().contains("A title mentioning the window does not replace this structured field"));
    }

    @ParameterizedTest
    @ValueSource(ints = {6, 12, 13})
    void requiresExplicitWindowsInsteadOfAnOmittedOrWrongDefault(int months) throws Exception {
        ObjectNode decision = fixture().put("originalInput", "Compare a year card at USD 600 per 12 months with a month card at USD 60 per month over exactly " + months + " months.");
        var error = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        assertEquals("decision.comparisonMonths", error.path());
        decision.put("comparisonMonths", months == 12 ? 6 : 12);
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        decision.put("comparisonMonths", months);
        contract.generatedDecision(decision);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "6|Compare these plans over 6 months.",
            "12|Compare these plans across exactly 12 months.",
            "13|Compare these plans over the next 13 months.",
            "6|Compare these plans with a comparison window of 6 months.",
            "12|The comparison horizon is 12 months for these plans.",
            "13|Compare these plans with a 13-month comparison window.",
            "13|Compare these plans with a 13‑month window."})
    void recognizesExplicitWindowPhrasesSeparatelyFromBillingPeriods(int months, String input) throws Exception {
        ObjectNode decision = fixture().put("originalInput", input);
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        contract.generatedDecision(decision.put("comparisonMonths", months));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "year card or month card",
            "Compare a year card costing USD 600 per 12 months with a month card costing USD 60 per month.",
            "A membership costs USD 600 for 12 months, or USD 60 for a month.",
            "A 12-month membership versus a monthly membership.",
            "Do 13 monthly visits on a year card or month card.",
            "Compare a subscription costing USD 13 and another costing USD 12."})
    void doesNotInferAWindowFromPricesBillingPeriodsOrUsage(String input) throws Exception {
        ObjectNode decision = fixture().put("originalInput", input);
        assertFalse(decision.has("comparisonMonths"));
        contract.generatedDecision(decision);
    }

    @Test
    void aRepeatedOmissionEndsWithAnActionableErrorInsteadOfShowingWrongTotals() throws Exception {
        ObjectNode omitted = fixture();
        model.reply(omitted, omitted);
        ApiException error = assertThrows(ApiException.class, () -> service.scenario(omitted.path("originalInput").asText()));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals("decision.comparisonMonths", error.issues().getFirst().path());
        assertEquals(2, model.requests.size());
    }

    private ObjectNode fixture() throws Exception {
        try (var stream = getClass().getResourceAsStream("/subscription-window-omitted-invalid.json")) { return (ObjectNode) mapper.readTree(stream); }
    }

    private final class RecordingModel implements ModelClient {
        final ArrayDeque<String> responses = new ArrayDeque<>();
        final List<List<Message>> requests = new ArrayList<>();
        void reply(JsonNode... replies) throws Exception { for (JsonNode reply : replies) responses.add(mapper.writeValueAsString(reply)); }
        @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return responses.remove(); }
        @Override public boolean configured() { return true; }
    }
}
