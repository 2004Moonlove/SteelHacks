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

class BreakEvenFlowTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @Test
    void validatesTheFrontendFixtureAndProducesLongTermStoriesWithCanonicalCosts() throws Exception {
        ObjectNode request = request();
        JsonNode original = request.deepCopy();
        validator.request(request);
        model.reply(draft());
        JsonNode response = service.story(request);
        assertEquals("qualitative", response.path("mode").asText());
        assertEquals("beginning", response.path("moments").get(0).path("key").asText());
        assertEquals("later", response.path("moments").get(2).path("key").asText());
        assertTrue(response.path("monthlyReflections").isEmpty());
        assertEquals(original, request);
        JsonNode input = mapper.readTree(model.requests.getFirst().get(1).content());
        assertEquals(request.path("facts"), input.path("facts"));
        assertEquals("Essential", input.path("optionA").path("selectedConsiderations").get(0).path("userImportance").asText());
        assertFalse(input.toString().contains("Drink variety"));
        assertFalse(input.toString().contains("\"usageCosts\""));
        assertFalse(input.toString().contains("\"calculation\""));
        assertTrue(model.requests.getFirst().getFirst().content().contains("A use-count crossing is not a time-to-payback prediction"));
    }

    @ParameterizedTest
    @CsvSource({"0,100,0,100,equal,0,0,0,machine", "0,100,0,200,no_crossing,0,0,0,machine",
            "100,100,0,100,no_crossing,0,0,0,machine", "100,200,0,100,no_crossing,0,0,0,machine",
            "100,10,0,13,crossing,100,3,34,machine", "0,600,30000,100,crossing,30000,500,60,shop",
            "9007199254740991,0,0,9007199254740990,crossing,9007199254740991,9007199254740990,2,machine"})
    void independentlyReconcilesEqualMissingFractionalReversedAndSafeIntegerCrossings(long a, long ar, long b, long br,
            String kind, long numerator, long denominator, long first, String recovery) throws Exception {
        ObjectNode request = request();
        costs(request, a, ar, b, br);
        ObjectNode crossover = (ObjectNode) request.path("snapshot").path("calculation").path("crossover");
        crossover.removeAll();
        crossover.put("kind", kind);
        String summary;
        if (kind.equals("crossing")) {
            crossover.put("numerator", numerator).put("denominator", denominator).put("firstWholeUse", first).put("recoveryOptionId", recovery);
            summary = (recovery.equals("machine") ? "Coffee machine" : "Buying coffee") + " has the same or lower modeled cost from use " + first + " onward.";
        } else summary = kind.equals("equal") ? "Both options have the same modeled cost at every use count."
                : "There is no positive break-even point with these costs.";
        ((ObjectNode) request.path("facts")).put("breakEvenSummary", summary);
        validator.request(request);
    }

    @ParameterizedTest
    @ValueSource(strings = {"numerator", "denominator", "firstWholeUse", "recoveryOptionId", "kind", "upfront", "rate", "result-option", "summary", "extra-fact", "missing-fact", "status", "unknown-price", "unconfirmed", "extra-crossover", "extra-cost", "extra-result"})
    void rejectsTamperedOrIncompleteBreakEvenRequestsBeforeCallingTheModel(String defect) throws Exception {
        ObjectNode request = request();
        ObjectNode calculation = (ObjectNode) request.path("snapshot").path("calculation");
        ObjectNode crossing = (ObjectNode) calculation.path("crossover");
        ObjectNode result = (ObjectNode) calculation.path("options").get(0);
        ObjectNode price = (ObjectNode) request.path("snapshot").path("decision").path("options").get(0).path("usageCosts").path("upfrontCents");
        switch (defect) {
            case "numerator", "denominator", "firstWholeUse" -> crossing.put(defect, 1);
            case "recoveryOptionId" -> crossing.put("recoveryOptionId", "shop");
            case "kind" -> crossing.put("kind", "equal");
            case "upfront" -> result.put("upfrontCents", 1);
            case "rate" -> result.put("perUseCents", 1);
            case "result-option" -> result.put("optionId", "shop");
            case "summary" -> ((ObjectNode) request.path("facts")).put("breakEvenSummary", "Coffee machine pays off tomorrow.");
            case "extra-fact" -> ((ObjectNode) request.path("facts")).put("monthlySavings", "$100.00");
            case "missing-fact" -> ((ObjectNode) request.path("facts")).remove("optionA_perUseCost");
            case "status" -> calculation.put("status", "qualitative");
            case "unknown-price" -> price.putNull("value").put("source", "unknown");
            case "unconfirmed" -> price.put("source", "demo_assumption").put("confirmed", false).put("note", "Example");
            case "extra-crossover" -> crossing.put("paybackMonths", 2);
            case "extra-cost" -> ((ObjectNode) request.path("snapshot").path("decision").path("options").get(0).path("usageCosts")).put("formula", "unsafe");
            case "extra-result" -> result.put("monthlyCost", 100);
            default -> throw new IllegalArgumentException(defect);
        }
        ApiException exception = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", exception.code());
        assertEquals(0, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-unit", "missing-costs", "monthly-baseline", "qualitative-costs", "quantitative-unit", "legacy-costs", "empty-unit", "unknown-cost-field"})
    void enforcesModeSpecificBaselineFields(String defect) throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ObjectNode option = (ObjectNode) decision.path("options").get(0);
        switch (defect) {
            case "missing-unit" -> decision.remove("usageUnit");
            case "missing-costs" -> option.remove("usageCosts");
            case "monthly-baseline" -> ((ArrayNode) option.path("activities")).addObject();
            case "qualitative-costs" -> decision.put("comparisonMode", "qualitative").remove("usageUnit");
            case "quantitative-unit" -> decision.put("comparisonMode", "quantitative");
            case "legacy-costs" -> { decision.put("schemaVersion", 1).remove("comparisonMode"); decision.remove("usageUnit"); }
            case "empty-unit" -> decision.put("usageUnit", " ");
            case "unknown-cost-field" -> ((ObjectNode) option.path("usageCosts")).put("timePerCup", 10);
            default -> throw new IllegalArgumentException(defect);
        }
        assertThrows(ContractValidator.ContractException.class, () -> contract.decision(decision));
    }

    @ParameterizedTest
    @CsvSource({"1,Not very important", "2,Slightly important", "3,Important", "4,Very important", "5,Essential"})
    void projectsOnlyExplicitUserImportanceAsTextWithoutChangingCosts(int priority, String label) throws Exception {
        ObjectNode request = request();
        JsonNode originalCosts = request.path("snapshot").path("calculation").deepCopy();
        ((ObjectNode) request.path("snapshot").path("decision").path("tags").get(0)).put("importance", priority);
        validator.request(request);
        JsonNode input = new StoryModelInput(mapper).project(request);
        assertEquals(label, input.path("optionA").path("selectedConsiderations").get(0).path("userImportance").asText());
        assertEquals(originalCosts, request.path("snapshot").path("calculation"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "6", "-1", "1.5", "null", "\"high\""})
    void rejectsInvalidImportanceValues(String value) throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ((ObjectNode) decision.path("tags").get(0)).set("importance", mapper.readTree(value));
        assertThrows(ContractValidator.ContractException.class, () -> contract.decision(decision));
    }

    @Test
    void doesNotInferImportanceAndRejectsModelGeneratedPriorities() throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(decision));
        ((ObjectNode) decision.path("tags").get(0)).remove("importance");
        contract.generatedDecision(decision);
        ObjectNode request = request();
        ((ObjectNode) request.path("snapshot")).set("decision", decision);
        assertFalse(new StoryModelInput(mapper).project(request).toString().contains("userImportance"));
    }

    @Test
    void keepsAllMissingCoffeePricesUnknownDespiteModelGeneratedNoAcquisitionNotes() throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ((ObjectNode) decision.path("tags").get(0)).remove("importance");
        for (JsonNode option : decision.path("options")) ((ObjectNode) option.path("usageCosts").path("upfrontCents"))
                .put("value", 0).put("source", "derived").put("note", "No equipment purchase is required for this option.");
        model.reply(decision);
        JsonNode generated = service.scenario("Should I buy a coffee machine or get coffee at Starbucks?");
        assertEquals("break_even", generated.path("comparisonMode").asText());
        assertTrue(generated.path("options").get(0).path("usageCosts").path("upfrontCents").path("value").isNull());
        assertTrue(generated.path("options").get(0).path("usageCosts").path("perUseCents").path("value").isNull());
        assertTrue(generated.path("options").get(1).path("usageCosts").path("perUseCents").path("value").isNull());
        assertTrue(generated.path("options").get(1).path("usageCosts").path("upfrontCents").path("value").isNull());
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("Use this mode even when prices are missing"));
        assertTrue(prompt.contains("Choose their number dynamically"));
        assertTrue(prompt.contains("Never generate importance"));
    }

    @Test
    void doesNotTreatAnUnexplainedZeroOrPerUseZeroAsNoAcquisitionEvidence() throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ObjectNode costs = (ObjectNode) decision.path("options").get(1).path("usageCosts");
        ((ObjectNode) costs.path("upfrontCents")).put("source", "derived").put("note", "Unverified estimate.");
        ((ObjectNode) costs.path("perUseCents")).put("value", 0).put("source", "derived").put("note", "No equipment purchase is required.");
        GeneratedValueNormalizer.normalize(decision, "Coffee machine versus Starbucks?");
        assertTrue(costs.path("upfrontCents").path("value").isNull());
        assertTrue(costs.path("perUseCents").path("value").isNull());
    }

    @Test
    void repairsTheCapturedCalendarPaybackErrorAndAddsTheCanonicalSummary() throws Exception {
        ObjectNode observed;
        try (var stream = getClass().getResourceAsStream("/coffee-break-even-calendar-draft.json")) {
            observed = (ObjectNode) mapper.readTree(stream);
        }
        ObjectNode corrected = observed.deepCopy();
        ((ObjectNode) corrected.path("optionB")).put("during", "Each purchased cup adds its per-use cost to cumulative spending.");
        model.reply(observed);
        model.reply(corrected);

        JsonNode response = service.story(request());

        assertEquals(2, model.requests.size());
        String repair = model.requests.get(1).getLast().content();
        assertTrue(repair.contains("use a use count only, not calendar time"));
        assertTrue(repair.contains("No daily, weekly, monthly, or yearly usage frequency was provided"));
        assertTrue(response.path("sharedScenario").path("description").asText().endsWith("{{breakEvenSummary}}"));
        assertEquals(corrected.path("optionB").path("during"), response.path("moments").get(1).path("options").get(1).path("text"));
        assertFalse(corrected.toString().contains("{{breakEvenSummary}}"), "Assembly must not mutate the model draft.");
    }

    @ParameterizedTest
    @ValueSource(strings = {"Consider how many months of purchases would equal the upfront price.",
            "The machine breaks even after several weeks.", "After some years it pays for itself.",
            "Consider how long it takes to recover the upfront cost.", "Calculate the number of days until the costs equal."})
    void rejectsCalendarPaybackWithoutInventingUsageFrequency(String text) throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionA")).put("later", text);
        model.reply(draft);
        model.reply(draft);
        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
        assertTrue(error.issues().getFirst().message().contains("use a use count only"));
    }

    @Test
    void allowsQualitativeCalendarContextAndDoesNotDuplicateAnExistingCanonicalSummary() throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionB")).put("later", "Months later, you could revisit whether the routine still fits your needs.");
        model.reply(draft);
        JsonNode response = service.story(request());
        assertEquals(1, response.toString().split("\\Q{{breakEvenSummary}}\\E", -1).length - 1);
        assertFalse(response.path("sharedScenario").path("description").asText().contains("{{breakEvenSummary}}"));
    }

    @Test
    void addsTheCanonicalSummaryToLegacyBreakEvenTextWithoutChangingItsIdentity() throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionA")).put("later", "You could revisit how the selected routine fits your needs.");
        ObjectNode legacy = (ObjectNode) new StoryDraftAssembler(mapper, contract).assemble(draft, request());
        ((ObjectNode) legacy.path("sharedScenario")).put("description", "The same use count applies to both paths.");
        model.reply(legacy);
        JsonNode response = service.story(request());
        assertEquals(legacy.path("decisionId"), response.path("decisionId"));
        assertEquals(legacy.path("simulationVersion"), response.path("simulationVersion"));
        assertTrue(response.path("sharedScenario").path("description").asText().endsWith("{{breakEvenSummary}}"));
    }

    private void costs(ObjectNode request, long a, long ar, long b, long br) {
        long[] upfront = {a, b}, rates = {ar, br};
        for (int i = 0; i < 2; i++) {
            JsonNode fields = request.path("snapshot").path("decision").path("options").get(i).path("usageCosts");
            ((ObjectNode) fields.path("upfrontCents")).put("value", upfront[i]);
            ((ObjectNode) fields.path("perUseCents")).put("value", rates[i]);
            ((ObjectNode) request.path("snapshot").path("calculation").path("options").get(i))
                    .put("upfrontCents", upfront[i]).put("perUseCents", rates[i]);
            ((ObjectNode) request.path("facts")).put((i == 0 ? "optionA" : "optionB") + "_upfrontCost", money(upfront[i]))
                    .put((i == 0 ? "optionA" : "optionB") + "_perUseCost", money(rates[i]));
        }
    }

    private String money(long cents) { return NumberFormat.getCurrencyInstance(Locale.US).format(BigDecimal.valueOf(cents, 2)); }

    private ObjectNode request() throws IOException {
        try (var stream = getClass().getResourceAsStream("/story-break-even-request.json")) { return (ObjectNode) mapper.readTree(stream); }
    }

    private ObjectNode draft() throws IOException {
        return (ObjectNode) mapper.readTree("""
            {"sharedScenario":{"title":"A shared coffee routine","description":"Both paths consider the same use count and selected needs."},
             "optionA":{"beginning":"{{optionA_name}} begins with {{optionA_upfrontCost}} upfront.","during":"The modeled cost is {{optionA_perUseCost}} per {{usageUnit}}.","later":"{{breakEvenSummary}}"},
             "optionB":{"beginning":"{{optionB_name}} begins with {{optionB_upfrontCost}} upfront.","during":"The modeled cost is {{optionB_perUseCost}} per {{usageUnit}}.","later":"You could revisit how buying coffee fits the selected routine."}}
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
