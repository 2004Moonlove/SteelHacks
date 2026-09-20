package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class SubscriptionFlowTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @Test
    void reconcilesTheSharedRenewalFixtureAndBuildsPairedScenesAdviceAndCostSummary() throws Exception {
        ObjectNode request = request();
        JsonNode original = request.deepCopy();
        validator.request(request);
        model.reply(draft());
        JsonNode story = service.story(request);
        assertEquals("qualitative", story.path("mode").asText());
        assertEquals(2, story.path("advice").size());
        assertEquals("annual", story.path("advice").get(0).path("optionId").asText());
        assertEquals("monthly", story.path("advice").get(1).path("optionId").asText());
        assertTrue(story.path("sharedScenario").path("description").asText().endsWith("{{subscriptionCostComparison}}"));
        assertTrue(story.path("monthlyReflections").isEmpty());
        assertEquals(original, request);
        JsonNode input = mapper.readTree(model.requests.getFirst().get(1).content());
        assertEquals(14, input.path("facts").size());
        assertEquals("Essential", input.path("optionA").path("selectedConsiderations").get(0).path("userImportance").asText());
        assertFalse(input.toString().contains("Changing where you live"));
        assertFalse(input.toString().contains("subscriptionCosts"));
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("Show actions and practical details rather than a checklist"));
        assertTrue(prompt.contains("do not invent a gym, commute, or workouts"));
        assertTrue(prompt.contains("not prorated or refunded"));
    }

    @ParameterizedTest
    @CsvSource({"1,60000,6000,1,12", "6,60000,36000,1,12", "12,60000,72000,1,12", "24,120000,144000,2,24", "120,600000,720000,10,120"})
    void validatesFullPaymentBoundariesAndShortWindowsWithoutProration(int months, long annualTotal, long monthlyTotal,
            int annualCount, int annualCoverage) throws Exception {
        ObjectNode request = request();
        window(request, months, 12, annualTotal, monthlyTotal, annualCount, annualCoverage);
        validator.request(request);
        assertEquals(60000, request.path("snapshot").path("calculation").path("timeline").get(1).path("optionACostCents").asLong());
        assertEquals(0, request.path("snapshot").path("calculation").path("timeline").get(0).path("optionACostCents").asLong());
    }

    @Test
    void defaultsOnlyTheComparisonWindowAndAllowsCoverageBeyondIt() throws Exception {
        ObjectNode defaultWindow = request();
        window(defaultWindow, 12, 12, 60000, 72000, 1, 12);
        ((ObjectNode) defaultWindow.path("snapshot").path("decision")).remove("comparisonMonths");
        validator.request(defaultWindow);
        ObjectNode longPeriod = request();
        window(longPeriod, 120, 119, 120000, 720000, 2, 238);
        validator.request(longPeriod);
    }

    @ParameterizedTest
    @ValueSource(strings = {"period-zero", "period-too-long", "period-number-object", "missing-period", "window-zero", "window-too-long", "unknown-payment", "unconfirmed", "overflow", "result-total", "payment-count", "coverage", "delta", "timeline-start", "timeline-renewal", "timeline-amortized", "timeline-order", "timeline-length", "comparison-window", "extra-result", "fact-total", "fact-comparison", "missing-fact", "extra-fact", "context"})
    void rejectsUntrustedPaymentsTimelinesAndFactsBeforeTheModel(String defect) throws Exception {
        ObjectNode request = request();
        ObjectNode snapshot = (ObjectNode) request.path("snapshot");
        ObjectNode decision = (ObjectNode) snapshot.path("decision");
        ObjectNode costs = (ObjectNode) decision.path("options").get(0).path("subscriptionCosts");
        ObjectNode payment = (ObjectNode) costs.path("paymentCents");
        ObjectNode calculation = (ObjectNode) snapshot.path("calculation");
        ObjectNode result = (ObjectNode) calculation.path("options").get(0);
        ArrayNode timeline = (ArrayNode) calculation.path("timeline");
        switch (defect) {
            case "period-zero" -> costs.put("periodMonths", 0);
            case "period-too-long" -> costs.put("periodMonths", 121);
            case "period-number-object" -> costs.putObject("periodMonths").put("value", 12).put("source", "derived");
            case "missing-period" -> costs.remove("periodMonths");
            case "window-zero" -> decision.put("comparisonMonths", 0);
            case "window-too-long" -> decision.put("comparisonMonths", 121);
            case "unknown-payment" -> payment.putNull("value").put("source", "unknown");
            case "unconfirmed" -> payment.put("source", "demo_assumption").put("note", "Example").put("confirmed", false);
            case "overflow" -> payment.put("value", 9_007_199_254_740_991L);
            case "result-total" -> result.put("totalCostCents", 60000);
            case "payment-count" -> result.put("paymentCount", 1);
            case "coverage" -> result.put("coverageMonths", 13);
            case "delta" -> ((ObjectNode) calculation.path("comparison")).put("costDeltaCents", 0);
            case "timeline-start" -> ((ObjectNode) timeline.get(0)).put("optionACostCents", 60000);
            case "timeline-renewal" -> ((ObjectNode) timeline.get(12)).put("optionACostCents", 120000);
            case "timeline-amortized" -> ((ObjectNode) timeline.get(1)).put("optionACostCents", 5000);
            case "timeline-order" -> ((ObjectNode) timeline.get(1)).put("month", 2);
            case "timeline-length" -> timeline.remove(13);
            case "comparison-window" -> calculation.put("comparisonMonths", 12);
            case "extra-result" -> result.put("refundCents", 100);
            case "fact-total" -> ((ObjectNode) request.path("facts")).put("optionA_totalCost", "$600.00");
            case "fact-comparison" -> ((ObjectNode) request.path("facts")).put("subscriptionCostComparison", "Year card is always better.");
            case "missing-fact" -> ((ObjectNode) request.path("facts")).remove("optionB_payment");
            case "extra-fact" -> ((ObjectNode) request.path("facts")).put("refundTerms", "Guaranteed refund");
            case "context" -> ((ObjectNode) request.path("context")).put("mode", "general");
            default -> throw new IllegalArgumentException(defect);
        }
        ApiException error = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", error.code());
        assertEquals(0, model.requests.size());
    }

    @Test
    void keepsMissingPricesUnknownWhilePreservingExplicitBillingPeriods() throws Exception {
        ObjectNode decision = generatedDecision();
        model.reply(decision);
        JsonNode result = service.scenario("year card or month card");
        assertEquals("subscription", result.path("comparisonMode").asText());
        assertEquals(12, result.path("options").get(0).path("subscriptionCosts").path("periodMonths").asInt());
        assertEquals(1, result.path("options").get(1).path("subscriptionCosts").path("periodMonths").asInt());
        for (JsonNode option : result.path("options")) {
            assertTrue(option.path("subscriptionCosts").path("paymentCents").path("value").isNull());
            assertTrue(option.path("activities").isEmpty());
            assertTrue(option.path("fixedCosts").isEmpty());
        }
        assertTrue(model.requests.getFirst().getFirst().content().contains("MUST return comparisonMode:\"subscription\""));
    }

    @ParameterizedTest
    @ValueSource(strings = {"1 year card or month card", "An annual gym membership or monthly membership?", "A year-long pass versus monthly pass"})
    void requiresCostComparisonForExplicitAnnualVersusMonthlyProducts(String input) throws Exception {
        ObjectNode decision = generatedDecision();
        decision.put("comparisonMode", "qualitative").put("originalInput", input).remove("comparisonMonths");
        for (JsonNode option : decision.path("options")) ((ObjectNode) option).remove("subscriptionCosts");
        var error = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        assertEquals("decision.comparisonMode", error.path());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Invest an annual bonus in QQQ or make monthly contributions to a CD?", "Annual travel or monthly local events?", "Yearly training or monthly mentoring?"})
    void doesNotRouteUnrelatedPeriodicDecisionsAsSubscriptionProducts(String input) throws Exception {
        ObjectNode decision = generatedDecision();
        decision.put("comparisonMode", "qualitative").put("originalInput", input).remove("comparisonMonths");
        for (JsonNode option : decision.path("options")) ((ObjectNode) option).remove("subscriptionCosts");
        contract.generatedDecision(decision);
    }

    @Test
    void broadSubscriptionsGetFactorCoverageButExplicitNarrowingIsRespected() throws Exception {
        ObjectNode decision = generatedDecision();
        decision.put("originalInput", "year card or month card");
        ArrayNode tags = (ArrayNode) decision.path("tags");
        while (tags.size() > 2) tags.remove(tags.size() - 1);
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        decision.put("originalInput", "year card or month card; only compare these two factors");
        contract.generatedDecision(decision);
        contract.decision(decision);
    }

    private ObjectNode generatedDecision() throws IOException {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        for (JsonNode tag : decision.path("tags")) ((ObjectNode) tag).remove("importance");
        return decision;
    }

    private void window(ObjectNode request, int months, int annualPeriod, long annualTotal, long monthlyTotal, int annualCount, int annualCoverage) {
        ObjectNode decision = (ObjectNode) request.path("snapshot").path("decision");
        decision.put("comparisonMonths", months);
        ((ObjectNode) decision.path("options").get(0).path("subscriptionCosts")).put("periodMonths", annualPeriod);
        ObjectNode calculation = (ObjectNode) request.path("snapshot").path("calculation");
        calculation.put("comparisonMonths", months);
        ((ObjectNode) calculation.path("options").get(0)).put("totalCostCents", annualTotal).put("paymentCount", annualCount).put("coverageMonths", annualCoverage);
        ((ObjectNode) calculation.path("options").get(1)).put("totalCostCents", monthlyTotal).put("paymentCount", months).put("coverageMonths", months);
        ArrayNode timeline = calculation.putArray("timeline");
        for (int m = 0; m <= months; m++) timeline.addObject().put("month", m)
                .put("optionACostCents", m == 0 ? 0 : 60000L * (1 + (m - 1) / annualPeriod)).put("optionBCostCents", m * 6000L);
        ((ObjectNode) calculation.path("comparison")).put("costDeltaCents", monthlyTotal - annualTotal);
        ObjectNode facts = (ObjectNode) request.path("facts");
        facts.put("comparisonMonths", Integer.toString(months)).put("optionA_periodMonths", Integer.toString(annualPeriod))
                .put("optionA_totalCost", money(annualTotal)).put("optionA_paymentCount", Integer.toString(annualCount)).put("optionA_coverageMonths", Integer.toString(annualCoverage))
                .put("optionB_totalCost", money(monthlyTotal)).put("optionB_paymentCount", Integer.toString(months)).put("optionB_coverageMonths", Integer.toString(months))
                .put("subscriptionCostComparison", "Year card costs " + money(annualTotal) + " and Month card costs " + money(monthlyTotal) + " over " + months + " " + (months == 1 ? "month" : "months") + ".");
    }

    private String money(long cents) { return NumberFormat.getCurrencyInstance(Locale.US).format(BigDecimal.valueOf(cents, 2)); }
    private ObjectNode request() throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-subscription-request.json")) { return (ObjectNode) mapper.readTree(stream); }
    }
    private ObjectNode draft() throws IOException {
        return (ObjectNode) mapper.readTree("""
            {"sharedScenario":{"title":"A possible membership routine","description":"Imagine returning to the selected service as part of a routine while keeping room for changing needs."},
             "optionA":{"beginning":"With {{optionA_name}}, you make the stated upfront payment and begin using the service.","during":"If your schedule changes, the prepaid access could remain available while you rearrange your routine.","later":"You reach a possible renewal point and can decide how that access fits your current needs.","advice":"Before committing, set aside {{optionA_payment}} and record the renewal terms so that the payment fits your budget."},
             "optionB":{"beginning":"With {{optionB_name}}, you start using the same service with the shorter stated billing period.","during":"If your schedule changes, you could use the next renewal point to adjust the arrangement under its actual terms.","later":"Your ongoing routine may make another renewal useful, or your needs may shift.","advice":"Before the next renewal, compare your actual use with the selected need and confirm the notice terms before changing the arrangement."}}
            """);
    }
    private final class RecordingModel implements ModelClient {
        final ArrayDeque<String> responses = new ArrayDeque<>();
        final List<List<Message>> requests = new ArrayList<>();
        void reply(JsonNode response) throws IOException { responses.add(mapper.writeValueAsString(response)); }
        @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return responses.remove(); }
        @Override public boolean configured() { return true; }
    }
}
