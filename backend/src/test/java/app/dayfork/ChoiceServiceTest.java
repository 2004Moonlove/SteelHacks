package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ChoiceServiceTest {
    static final String INPUT = "Annual plan costs CNY 1200; monthly costs CNY 150. I will use 4 months, with no other fees. I care most about cost.";
    final ObjectMapper mapper = new ObjectMapper();
    final FakeModel model = new FakeModel();
    final ChoiceValidator validator = new ChoiceValidator();
    ChoiceService service;
    MockMvc mvc;

    @BeforeEach void setup() {
        service = new ChoiceService(model, mapper, validator);
        mvc = MockMvcBuilders.standaloneSetup(new ChoiceController(service)).setControllerAdvice(new ApiErrorHandler()).build();
    }

    @Test void exposesGenerationEndpointAndForcesLiveMetadata() throws Exception {
        ObjectNode result = decision();
        result.put("mode", "demo").put("originalInput", "Invented input").put("version", 999);
        model.reply(result);
        mvc.perform(post("/api/choices/generate").contentType(MediaType.APPLICATION_JSON).content(mapper.createObjectNode().put("description", INPUT).toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mode").value("live"))
                .andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.originalInput").value(INPUT))
                .andExpect(jsonPath("$.options[0].costs[0].amount.value").value(120000));
        assertEquals(1, model.calls.size());
    }

    @Test void repairsInvalidJsonOnlyOnce() {
        model.reply("not JSON", decision());
        assertEquals(2, service.generate(description()).path("schemaVersion").asInt());
        assertEquals(2, model.calls.size());
        assertEquals("assistant", model.calls.get(1).get(2).role());
    }

    @Test void rejectsInvalidOutputAfterOneRepairWithoutFakeFallback() {
        model.reply("{}", "{}");
        ApiException error = assertThrows(ApiException.class, () -> service.generate(description()));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(HttpStatus.BAD_GATEWAY, error.status());
        assertEquals(2, model.calls.size());
    }

    @Test void providerFailuresAreNotSemanticallyRetried() {
        model.reply(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_RATE_LIMITED", "Please retry later."));
        ApiException error = assertThrows(ApiException.class, () -> service.generate(description()));
        assertEquals("MODEL_RATE_LIMITED", error.code());
        assertEquals(1, model.calls.size());
    }

    @Test void unknownInputsRemainNull() {
        ObjectNode output = decision();
        ((ObjectNode) output.path("context")).set("months", unknown());
        model.reply(output);
        assertTrue(service.generate(description()).path("context").path("months").path("value").isNull());
    }

    @ParameterizedTest @ValueSource(strings = {"user_edit", "demo"})
    void modelCannotClaimUserEditsOrDemoValues(String source) {
        rejectGenerated(d -> ((ObjectNode) d.path("options").get(0).path("costs").get(0).path("amount")).put("source", source));
    }

    @Test void unverifiableKnownValueBecomesUnknownWhileFractionalMinorUnitsStillFail() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("options").get(0).path("costs").get(0).path("amount")).put("quote", "CNY 900");
        model.reply(decision);
        JsonNode result = service.generate(description());
        assertTrue(result.path("options").get(0).path("costs").get(0).path("amount").path("value").isNull());
        assertEquals("unknown", result.path("options").get(0).path("costs").get(0).path("amount").path("source").asText());
        rejectGenerated(d -> ((ObjectNode) d.path("options").get(0).path("costs").get(0).path("amount")).put("value", 120000.5));
    }

    @Test void modelCannotConfirmItsOwnHardConstraint() {
        rejectGenerated(d -> {
            ObjectNode factor = (ObjectNode) d.path("factors").get(0);
            factor.put("purpose", "hard").put("origin", "model").put("confirmed", true);
            ((ObjectNode) factor.path("target")).put("max", 10000);
        });
    }

    @Test void explicitHardConstraintNeedsExactEvidenceAndIsPreserved() {
        String input = INPUT + " My budget must not exceed CNY 1000.";
        ObjectNode output = decision();
        ObjectNode factor = (ObjectNode) output.path("factors").get(1);
        factor.put("id", "budget").put("name", "Budget").put("purpose", "hard").put("origin", "user").put("confirmed", true)
                .put("userQuote", "My budget must not exceed CNY 1000.").put("ruleId", "total_cost").put("dataType", "money").put("unit", "CNY").put("direction", "target");
        ((ObjectNode) factor.path("target")).put("max", 100000);
        model.reply(output);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", input));
        assertEquals("hard", result.path("factors").get(1).path("purpose").asText());
        assertEquals(100000, result.path("factors").get(1).path("target").path("max").asInt());
    }

    @Test void unquotedHardRequirementIsRejected() {
        rejectGenerated(d -> {
            ObjectNode factor = (ObjectNode) d.path("factors").get(0);
            factor.put("purpose", "hard"); factor.remove("userQuote");
            ((ObjectNode) factor.path("target")).put("max", 100000);
            d.putNull("primaryFactorId");
        });
    }

    @Test void arbitraryCalculationCodeIsRejected() {
        rejectGenerated(d -> ((ObjectNode) d.path("factors").get(0)).put("ruleId", "eval(price * months)"));
    }

    @Test void emptyMaterialsReturnExplicitStateWithoutModelAccess() throws Exception {
        ObjectNode request = materialRequest(decision());
        mvc.perform(post("/api/choices/materials").contentType(MediaType.APPLICATION_JSON).content(request.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("no_materials"))
                .andExpect(jsonPath("$.findings.length()").value(0));
        assertTrue(model.calls.isEmpty());
    }

    @Test void materialAnalysisSupportsMultipleLabelsAndCrossMaterialConflict() {
        ObjectNode decision = withMaterials();
        model.reply(analysis());
        String before = decision.toString();
        JsonNode result = service.materials(materialRequest(decision));
        assertEquals("inconsistent", result.path("status").asText());
        assertEquals(2, result.path("findings").get(0).path("labels").size());
        assertEquals(before, decision.toString());
        assertEquals(120000, decision.path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
    }

    @Test void otherOptionsMaterialsAreNotSentToTheAnalysisModel() {
        ObjectNode decision = withMaterials();
        ((ArrayNode) decision.path("options").get(1).path("materials")).addObject().put("id", "private-other").put("title", "Other quote").put("text", "Other option private offer");
        model.reply(analysis());
        service.materials(materialRequest(decision));
        assertFalse(model.calls.get(0).get(1).content().contains("Other option private offer"));
        assertEquals(1, decision.path("options").get(1).path("materials").size());
    }

    @Test void inventedMaterialQuoteIsRejected() {
        rejectAnalysis(a -> ((ObjectNode) a.path("findings").get(0).path("quotes").get(0)).put("quote", "Made up evidence"));
    }

    @Test void conflictNeedsEvidenceFromDifferentMaterials() {
        rejectAnalysis(a -> {
            ((ArrayNode) a.path("findings").get(0).path("materialIds")).remove(1);
            ((ArrayNode) a.path("findings").get(0).path("quotes")).remove(1);
        });
    }

    @Test void noPressureStatusCannotHideAConflict() {
        rejectAnalysis(a -> a.put("status", "no_pressure_found"));
    }

    @Test void extractedCurrencyMustMatchAndNeverOverwritesParameters() {
        rejectAnalysis(a -> ((ObjectNode) a.path("extractions").get(0)).put("unit", "USD"));
    }

    @Test void staleOrForeignAnalysisCannotBeReturned() {
        rejectAnalysis(a -> a.put("decisionVersion", 99));
        model.calls.clear();
        rejectAnalysis(a -> ((ObjectNode) a.path("findings").get(0)).put("optionId", "monthly"));
    }

    @Test void suggestedFactorsAreSeparateVersionedProposals() throws Exception {
        ObjectNode decision = decision();
        ObjectNode response = suggestions(decision);
        model.reply(response);
        ObjectNode request = mapper.createObjectNode().set("decision", decision);
        request.put("instruction", "I need to bring my cat.");
        String before = decision.toString();
        mvc.perform(post("/api/choices/factors").contentType(MediaType.APPLICATION_JSON).content(request.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.factors[0].id").value("cat"))
                .andExpect(jsonPath("$.decisionVersion").value(1));
        assertEquals(before, decision.toString());
    }

    @Test void factorSuggestionsDiscardUnauthorizedTopLevelMutationsWithoutChangingDecision() {
        ObjectNode decision = decision();
        ((ArrayNode) decision.path("assumptions")).add("I expect to stay in this city.");
        ObjectNode response = suggestions(decision);
        response.putArray("assumptions").add("Replace the user's plans.");
        response.putArray("options").addObject().put("id", "replacement");
        response.put("primaryFactorId", "cat");
        ObjectNode expected = suggestions(decision);
        model.reply(response);
        ObjectNode request = mapper.createObjectNode().set("decision", decision);
        request.put("instruction", "I need to bring my cat.");
        String before = request.toString();
        assertEquals(expected, service.factors(request));
        assertEquals(before, request.toString());
        assertEquals(1, model.calls.size());
    }

    @Test void discardingTopLevelExtrasDoesNotRelaxFactorObjectValidation() {
        ObjectNode decision = decision();
        ObjectNode response = suggestions(decision);
        response.putArray("assumptions").add("Extra metadata.");
        ((ObjectNode) response.path("factors").get(0)).put("overwriteExisting", true);
        model.reply(response, response);
        ObjectNode request = mapper.createObjectNode().set("decision", decision);
        request.put("instruction", "I need to bring my cat.");
        String before = request.toString();
        assertEquals("MODEL_OUTPUT_INVALID", assertThrows(ApiException.class, () -> service.factors(request)).code());
        assertEquals(before, request.toString());
        assertEquals(2, model.calls.size());
    }

    @Test void suggestionsCannotReuseAnExistingIdOrSemanticRule() {
        ObjectNode decision = decision();
        ObjectNode response = suggestions(decision);
        ((ObjectNode) response.path("factors").get(0)).put("id", "total-cost");
        model.reply(response, response);
        ObjectNode request = mapper.createObjectNode().set("decision", decision);
        request.put("instruction", "I need to bring my cat.");
        assertEquals("MODEL_OUTPUT_INVALID", assertThrows(ApiException.class, () -> service.factors(request)).code());
        assertEquals(3, decision.path("factors").size());
    }

    @Test void rejectsBadInputsBeforeCallingModel() throws Exception {
        ObjectNode bad = decision();
        ((ObjectNode) bad.path("context").path("usesPerMonth")).put("value", -1).put("source", "user_edit");
        mvc.perform(post("/api/choices/materials").contentType(MediaType.APPLICATION_JSON).content(materialRequest(bad).toString()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(post("/api/choices/generate").contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/choices/generate").contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"A or B\",\"apiKey\":\"not-allowed\"}"))
                .andExpect(status().isBadRequest());
        assertTrue(model.calls.isEmpty());
    }

    @Test void unsupportedFieldsAndTrailingJsonAreRejected() {
        ObjectNode decision = decision();
        decision.put("uncontrolledChart", "javascript");
        model.reply(decision, decision().toString() + " {}");
        assertEquals("MODEL_OUTPUT_INVALID", assertThrows(ApiException.class, () -> service.generate(description())).code());
    }

    @Test void costCompletenessMustHaveExplicitInputEvidence() {
        ObjectNode decision = decision();
        decision.putArray("goals");
        for (JsonNode factor : decision.path("factors")) ((ObjectNode) factor).put("origin", "model").put("confirmed", false).remove("userQuote");
        decision.putNull("primaryFactorId");
        // Known numbers retain valid quotes; only the complete-cost statement is removed.
        String incomplete = "Annual plan costs CNY 1200; monthly costs CNY 150. I will use 4 months.";
        model.reply(decision);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", incomplete));
        assertFalse(result.path("options").get(0).path("costsComplete").asBoolean());
        assertFalse(result.path("options").get(1).path("costsComplete").asBoolean());
        assertEquals(120000, result.path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
    }

    @Test void moreThanSixExplicitFactorsAreNotDroppedBySchemaCap() {
        ObjectNode decision = decision();
        ArrayNode factors = (ArrayNode) decision.path("factors");
        for (int i = 0; i < 6; i++) {
            ObjectNode factor = factor("additional-" + i, "Additional consideration " + i, "boolean");
            factors.add(factor);
        }
        model.reply(decision);
        assertEquals(9, service.generate(description()).path("factors").size());
    }

    @Test void currentUserEditsStayValidWhenOriginalDescriptionChanges() {
        ObjectNode decision = decision();
        decision.put("originalInput", "Updated description after user review.");
        ObjectNode primary = (ObjectNode) decision.path("factors").get(0);
        primary.put("reason", "").put("origin", "model").put("confirmed", false);
        assertEquals("no_materials", service.materials(materialRequest(decision)).path("status").asText());
        assertTrue(model.calls.isEmpty());
    }

    @Test void rejectsForeignFactorValuesDuplicateMaterialsAndInvalidCategoryRangeBeforeModel() {
        ObjectNode decision = decision();
        ((ArrayNode) decision.path("factors").get(0).path("optionIds")).remove(1);
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.materials(materialRequest(decision))).code());
        ObjectNode duplicate = withMaterials();
        ((ArrayNode) duplicate.path("options").get(1).path("materials")).add(duplicate.path("options").get(0).path("materials").get(0).deepCopy());
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.materials(materialRequest(duplicate))).code());
        ObjectNode invalidRange = decision();
        ((ObjectNode) invalidRange.path("factors").get(1).path("target")).put("min", true);
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.materials(materialRequest(invalidRange))).code());
        assertTrue(model.calls.isEmpty());
    }

    @Test void translatesDisplayTextButPreservesExactChineseEvidence() {
        ObjectNode output = decision();
        ((ObjectNode) output.path("goals").get(0)).put("text", "必须能带猫");
        model.reply(output, decision());
        assertEquals("Keep costs low", service.generate(description()).path("goals").get(0).path("text").asText());
        assertEquals(2, model.calls.size());
        assertTrue(model.calls.get(1).get(3).content().contains("Display text must be English"));
        ObjectNode chinese = decision();
        String input = INPUT + " 我希望便宜。";
        ((ObjectNode) chinese.path("goals").get(0)).put("quote", "我希望便宜。");
        model.reply(chinese);
        assertEquals("我希望便宜。", service.generate(mapper.createObjectNode().put("description", input)).path("goals").get(0).path("quote").asText());
    }

    @Test void capturedLiveGymCannotTreatAnnualFeeAsOneTime() throws Exception {
        ObjectNode captured = capturedGym();
        model.reply(captured, captured);
        ApiException error = assertThrows(ApiException.class, () -> service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText())));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertTrue(error.issues().get(0).path().endsWith("costs.cadence"));
    }

    @Test void capturedLiveGymCannotRankUsingStaticModelTotalsOrBudgetBoolean() throws Exception {
        ObjectNode captured = capturedGym();
        ((ObjectNode) captured.path("options").get(0).path("costs").get(0)).put("cadence", "annual");
        model.reply(captured, captured);
        ApiException missingRule = assertThrows(ApiException.class, () -> service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText())));
        assertTrue(missingRule.issues().get(0).path().endsWith("total-cost.ruleId"));
        ((ObjectNode) captured.path("factors").get(0)).put("ruleId", "total_cost");
        model.reply(captured, captured);
        ApiException budgetBoolean = assertThrows(ApiException.class, () -> service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText())));
        assertTrue(budgetBoolean.issues().get(0).path().endsWith("budget-adherence.ruleId"));
    }

    @Test void correctedLiveGymDiscardsUntrustedComputedFactorNumbersAndPreservesKnownCosts() throws Exception {
        ObjectNode corrected = capturedGym();
        ((ObjectNode) corrected.path("options").get(0).path("costs").get(0)).put("cadence", "annual");
        ((ObjectNode) corrected.path("factors").get(0)).put("ruleId", "total_cost");
        ((ArrayNode) corrected.path("factors")).remove(1);
        model.reply(corrected);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", corrected.path("originalInput").asText()));
        assertEquals(120000, result.path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
        assertEquals(15000, result.path("options").get(1).path("costs").get(0).path("amount").path("value").asInt());
        assertEquals(130000, result.path("context").path("budgetCents").path("value").asInt());
        for (JsonNode value : result.path("factors").get(0).path("values")) {
            assertTrue(value.path("value").isNull());
            assertEquals("unknown", value.path("source").asText());
        }
    }

    @Test void safelyNormalizesAbsentOptionalFieldsAndMissingValueLabels() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("context").path("usesPerMonth")).put("source", "user_input").putNull("quote").putNull("materialId");
        ((ObjectNode) decision.path("factors").get(1)).putNull("ruleId").putNull("userQuote");
        model.reply(decision);
        JsonNode result = service.generate(description());
        assertTrue(result.path("context").path("usesPerMonth").path("value").isNull());
        assertEquals("unknown", result.path("context").path("usesPerMonth").path("source").asText());
        assertFalse(result.path("factors").get(1).has("ruleId"));
    }

    @Test void modelCalculatedNonRuleValuesRemainUnknownUntilUserConfirmsFacts() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("factors").get(1).path("values").get("annual")).put("value", true).put("source", "derived").put("note", "Assumed from a calculation.");
        model.reply(decision);
        JsonNode result = service.generate(description());
        assertTrue(result.path("factors").get(1).path("values").get("annual").path("value").isNull());
    }

    private ObjectNode capturedGym() throws Exception {
        try (var stream = getClass().getResourceAsStream("/choice-gym-live-invalid.json")) { return (ObjectNode) mapper.readTree(stream); }
    }

    @Test void quotedMajorCurrencyCannotBeMistakenForMinorUnits() {
        rejectGenerated(d -> ((ObjectNode) d.path("options").get(0).path("costs").get(0).path("amount")).put("value", 1200));
        model.calls.clear();
        rejectAnalysis(a -> ((ObjectNode) a.path("extractions").get(0)).put("value", 1300));
    }

    @Test void commaSeparatedCurrencyAndExplicitMinorUnitsAreGrounded() {
        ObjectNode decision = decision();
        String input = INPUT + " Price 1,200.00 CNY is 120000 cents.";
        ((ObjectNode) decision.path("options").get(0).path("costs").get(0).path("amount")).put("quote", "1,200.00 CNY");
        model.reply(decision);
        assertEquals(120000, service.generate(mapper.createObjectNode().put("description", input)).path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
        ((ObjectNode) decision.path("options").get(0).path("costs").get(0).path("amount")).put("quote", "120000 cents");
        model.reply(decision);
        assertEquals(120000, service.generate(mapper.createObjectNode().put("description", input)).path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
    }

    @Test void quotedMoneyRequirementCannotChangeCurrencyScale() {
        ObjectNode output = decision();
        String input = INPUT + " My budget must not exceed CNY 1000.";
        ObjectNode factor = (ObjectNode) output.path("factors").get(1);
        factor.put("id", "budget").put("name", "Budget").put("purpose", "hard").put("origin", "user").put("confirmed", true)
                .put("userQuote", "My budget must not exceed CNY 1000.").put("ruleId", "total_cost").put("dataType", "money").put("unit", "CNY").put("direction", "target");
        ((ObjectNode) factor.path("target")).put("max", 1000);
        model.reply(output, output);
        ApiException error = assertThrows(ApiException.class, () -> service.generate(mapper.createObjectNode().put("description", input)));
        assertEquals("factors.budget.target.max", error.issues().get(0).path());
    }

    @Test void missingShapeUsesEmptyMetadataAndUnknownFactsWithoutInventingRequirements() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("factors").get(0)).remove("allowedValues");
        ((ObjectNode) decision.path("factors").get(0)).remove("target");
        ((ObjectNode) decision.path("factors").get(1).path("target")).remove("max");
        ((ObjectNode) decision.path("factors").get(1).path("values")).remove("annual");
        ((ObjectNode) decision.path("options").get(0)).remove(List.of("materials", "minutesPerMonth"));
        ((ObjectNode) decision.path("context")).remove("usesPerMonth");
        model.reply(decision);
        JsonNode result = service.generate(description());
        assertTrue(result.path("factors").get(0).path("allowedValues").isEmpty());
        assertTrue(result.path("factors").get(0).path("target").path("max").isNull());
        assertTrue(result.path("options").get(0).path("minutesPerMonth").path("value").isNull());
        assertTrue(result.path("context").path("usesPerMonth").path("value").isNull());
        assertTrue(result.path("factors").get(1).path("values").path("annual").path("value").isNull());
        assertEquals(120000, result.path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
        assertEquals(1, model.calls.size());
    }

    @Test void scheduleBooleanWithoutEvidenceRemainsUnknown() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("factors").get(1).path("values").path("annual")).put("value", true).put("source", "user_input");
        model.reply(decision);
        JsonNode result = service.generate(description());
        assertTrue(result.path("factors").get(1).path("values").path("annual").path("value").isNull());
        assertEquals("unknown", result.path("factors").get(1).path("values").path("annual").path("source").asText());
    }

    @Test void missingTargetDoesNotInventOrDowngradeExplicitHardRequirement() {
        rejectGenerated(decision -> {
            ObjectNode factor = (ObjectNode) decision.path("factors").get(0);
            factor.put("purpose", "hard"); factor.remove("target"); decision.putNull("primaryFactorId");
        });
    }

    @Test void whitespaceOnlyMaterialQuoteIsMappedBackToExactSourceText() {
        ObjectNode decision = withMaterials();
        ((ObjectNode) decision.path("options").get(0).path("materials").get(1)).put("text", "Annual price\nCNY 1300. No cancellation for 12 months.");
        model.reply(analysis());
        JsonNode result = service.materials(materialRequest(decision));
        assertEquals("Annual price\nCNY 1300.", result.path("findings").get(0).path("quotes").get(1).path("quote").asText());
        assertEquals("Annual price\nCNY 1300.", result.path("extractions").get(0).path("quote").asText());
    }

    @Test void materialParaphraseOrPunctuationChangeStillFailsExactEvidence() {
        rejectAnalysis(a -> ((ObjectNode) a.path("findings").get(0).path("quotes").get(1)).put("quote", "Annual price: CNY 1300."));
    }

    @Test void originalOptionNamesAndUserDataMayKeepTheirLanguage() {
        ObjectNode decision = decision();
        String input = INPUT + " The annual option is called 星光健身. Its access note is 随时进入.";
        ((ObjectNode) decision.path("options").get(0)).put("name", "星光健身");
        ((ObjectNode) decision.path("factors").get(2).path("values").path("annual")).put("value", "随时进入").put("source", "user_input").put("quote", "随时进入");
        model.reply(decision);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", input));
        assertEquals("星光健身", result.path("options").get(0).path("name").asText());
        assertEquals("随时进入", result.path("factors").get(2).path("values").path("annual").path("value").asText());
    }

    @Test void actualLiveGymDoesNotDoubleCountUsageOrFreezeADuplicateBudget() throws Exception {
        ObjectNode captured = resource("/choice-gym-live-duplicate-time.json");
        model.reply(captured);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText()));
        assertEquals(130000, result.path("context").path("budgetCents").path("value").asInt());
        assertEquals("subscription", result.path("template").asText());
        assertEquals(1, result.path("factors").size());
        assertEquals("total-cost", result.path("factors").get(0).path("id").asText());
        for (JsonNode option : result.path("options")) {
            assertEquals(60, option.path("minutesPerUse").path("value").asInt());
            assertTrue(option.path("minutesPerMonth").path("value").isNull());
        }
    }

    @Test void independentlyStatedMonthlyTimeAndDistinctBudgetConstraintArePreserved() throws Exception {
        ObjectNode captured = resource("/choice-gym-live-duplicate-time.json");
        String input = captured.path("originalInput").asText() + " Additional monthly admin time is 90 minutes. I also require CNY 1200 as the annual option limit.";
        ((ObjectNode) captured.path("options").get(0).path("minutesPerMonth")).put("value", 90).put("source", "user_input").put("quote", "Additional monthly admin time is 90 minutes.");
        ObjectNode factor = (ObjectNode) captured.path("factors").get(1);
        ((ObjectNode) factor.path("target")).put("max", 120000);
        factor.put("userQuote", "I also require CNY 1200 as the annual option limit.");
        ((ArrayNode) factor.path("optionIds")).remove(1);
        ((ObjectNode) factor.path("values")).remove("monthly");
        model.reply(captured);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", input));
        assertEquals(90, result.path("options").get(0).path("minutesPerMonth").path("value").asInt());
        assertEquals(2, result.path("factors").size());
        assertEquals(120000, result.path("factors").get(1).path("target").path("max").asInt());
    }

    @Test void actualCourseDeferralDoesNotBecomeAnInventedZeroPrice() throws Exception {
        ObjectNode captured = resource("/choice-course-live-inferred-free.json");
        model.reply(captured);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText()));
        boolean checked = false;
        for (JsonNode factor : result.path("factors")) if (factor.path("dataType").asText().equals("money")) {
            for (JsonNode value : factor.path("values")) {
                assertTrue(value.path("value").isNull()); checked = true;
            }
        }
        assertTrue(checked);
    }

    @Test void suppliedZeroMoneyAndUnknownCostsAreDistinguished() {
        assertFalse(ChoiceValidator.explicitCompleteCosts("I do not know the total costs."));
        assertFalse(ChoiceValidator.explicitCompleteCosts("总费用还不清楚。"));
        assertFalse(ChoiceValidator.explicitCompleteCosts("Are there no other fees?"));
        assertTrue(ChoiceValidator.explicitCompleteCosts("Both plans have no other fees."));
        assertTrue(ChoiceValidator.explicitCompleteCosts("两种服务相同且无其他费用。"));
        ObjectNode decision = decision();
        String input = INPUT + " A trial is explicitly free of charge.";
        ((ObjectNode) decision.path("options").get(0).path("costs").get(0).path("amount")).put("value", 0).put("quote", "A trial is explicitly free of charge.");
        model.reply(decision);
        assertEquals(0, service.generate(mapper.createObjectNode().put("description", input)).path("options").get(0).path("costs").get(0).path("amount").path("value").asInt());
    }

    @Test void aCopiedChineseValueNoteDoesNotDiscardVerifiableFacts() {
        ObjectNode decision = decision();
        ((ObjectNode) decision.path("options").get(0).path("costs").get(0).path("amount")).put("note", "年费来自用户输入");
        model.reply(decision);
        JsonNode amount = service.generate(description()).path("options").get(0).path("costs").get(0).path("amount");
        assertEquals(120000, amount.path("value").asInt());
        assertEquals("CNY 1200", amount.path("quote").asText());
        assertEquals("Review the cited source and confirm this value.", amount.path("note").asText());
    }

    @Test void explicitUrgencyCannotBeSilentlyReturnedAsCleanOrIgnored() {
        ObjectNode omitted = analysis();
        ((ArrayNode) omitted.path("findings")).remove(1);
        model.reply(omitted, analysis());
        JsonNode result = service.materials(materialRequest(withMaterials()));
        assertEquals(2, model.calls.size());
        assertTrue(model.calls.get(1).get(3).content().contains("urgency cue was omitted"));
        assertEquals("urgency", result.path("findings").get(1).path("labels").get(0).asText());
    }

    private ObjectNode resource(String path) throws Exception {
        try (var stream = getClass().getResourceAsStream(path)) { return (ObjectNode) mapper.readTree(stream); }
    }

    @Test void actualLiveExplicitCostPriorityMustNotBeLostToSkeletonDefaults() throws Exception {
        ObjectNode captured = resource("/choice-gym-live-missing-primary.json");
        ObjectNode repaired = captured.deepCopy();
        repaired.put("primaryFactorId", "total-cost");
        ((ObjectNode) repaired.path("factors").get(0)).put("origin", "user").put("confirmed", true).put("userQuote", "我首先考虑总支出");
        model.reply(captured, repaired);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText()));
        assertEquals(2, model.calls.size());
        assertEquals("total-cost", result.path("primaryFactorId").asText());
        assertEquals("user", result.path("factors").get(0).path("origin").asText());
        assertTrue(result.path("factors").get(0).path("confirmed").asBoolean());
        assertTrue(model.calls.get(1).get(3).content().contains("explicitly named total cost as the first priority"));
    }

    @Test void explicitEnglishCostPriorityRequiresTheSameVersionedPreference() {
        ObjectNode decision = decision();
        String input = INPUT + " My first priority is total cost.";
        decision.putNull("primaryFactorId");
        model.reply(decision, decision);
        ApiException error = assertThrows(ApiException.class, () -> service.generate(mapper.createObjectNode().put("description", input)));
        assertEquals("primaryFactorId", error.issues().get(0).path());
    }

    @Test void mentioningCostDoesNotInventAPrimaryPreference() {
        ObjectNode decision = decision();
        String input = INPUT.replace(" I care most about cost.", "") + " Please show cost tradeoffs.";
        decision.putArray("goals");
        decision.putNull("primaryFactorId");
        ((ObjectNode) decision.path("factors").get(0)).put("origin", "model").put("confirmed", false).remove("userQuote");
        model.reply(decision);
        assertTrue(service.generate(mapper.createObjectNode().put("description", input)).path("primaryFactorId").isNull());
    }

    @Test void actualGenericWishRemainsAPreferenceAndDeferredOutcomesRemainUnknown() throws Exception {
        ObjectNode captured = resource("/choice-course-live-wish-constraint.json");
        model.reply(captured);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", captured.path("originalInput").asText()));
        JsonNode artwork = result.path("factors").get(0), saturday = result.path("factors").get(1);
        assertEquals("preference", artwork.path("purpose").asText());
        assertTrue(artwork.path("confirmed").asBoolean());
        assertEquals("我想做出一个可以带回家的作品", artwork.path("userQuote").asText());
        assertEquals("hard", saturday.path("purpose").asText());
        assertTrue(saturday.path("target").path("desired").asBoolean());
        for (JsonNode factor : result.path("factors")) if (factor.path("dataType").asText().equals("boolean")) {
            for (JsonNode value : factor.path("values")) assertTrue(value.path("value").isNull());
        }
        assertTrue(result.path("primaryFactorId").isNull());
    }

    @Test void directlyStatedOptionBooleanFactsRemainIntact() {
        ObjectNode decision = decision();
        String input = INPUT + " Annual membership permits cancellation. Monthly membership does not permit cancellation.";
        ((ObjectNode) decision.path("factors").get(1).path("values").path("annual")).put("value", true).put("source", "user_input").put("quote", "Annual membership permits cancellation.");
        ((ObjectNode) decision.path("factors").get(1).path("values").path("monthly")).put("value", false).put("source", "user_input").put("quote", "Monthly membership does not permit cancellation.");
        model.reply(decision);
        JsonNode result = service.generate(mapper.createObjectNode().put("description", input));
        assertTrue(result.path("factors").get(1).path("values").path("annual").path("value").asBoolean());
        assertFalse(result.path("factors").get(1).path("values").path("monthly").path("value").asBoolean());
        assertFalse(result.path("factors").get(1).path("values").path("monthly").path("value").isNull());
    }

    @Test void aFirmRequirementMustHaveNecessityEvidenceRatherThanJustAnArbitrarySourceQuote() {
        rejectGenerated(decision -> {
            ObjectNode factor = (ObjectNode) decision.path("factors").get(0);
            factor.put("purpose", "hard");
            ((ObjectNode) factor.path("target")).put("max", 120000);
            factor.put("userQuote", "CNY 1200"); decision.putNull("primaryFactorId");
        });
    }

    private void rejectGenerated(Consumer<ObjectNode> edit) {
        ObjectNode output = decision(); edit.accept(output); model.reply(output, output);
        assertEquals("MODEL_OUTPUT_INVALID", assertThrows(ApiException.class, () -> service.generate(description())).code());
    }
    private void rejectAnalysis(Consumer<ObjectNode> edit) {
        ObjectNode output = analysis(); edit.accept(output); model.reply(output, output);
        assertEquals("MODEL_OUTPUT_INVALID", assertThrows(ApiException.class, () -> service.materials(materialRequest(withMaterials()))).code());
    }
    private ObjectNode description() { return mapper.createObjectNode().put("description", INPUT); }
    private ObjectNode unknown() { return mapper.createObjectNode().putNull("value").put("source", "unknown").put("note", "Not provided."); }
    private ObjectNode known(int value, String quote) { return mapper.createObjectNode().put("value", value).put("source", "user_input").put("note", "Explicit input in canonical units.").put("quote", quote); }
    private ObjectNode materialRequest(JsonNode decision) {
        ObjectNode request = mapper.createObjectNode().put("optionId", "annual"); request.set("decision", decision); return request;
    }
    ObjectNode decision() {
        ObjectNode d = mapper.createObjectNode().put("schemaVersion", 2).put("id", "gym-choice").put("version", 1).put("title", "Gym membership")
                .put("description", "Compare payment and flexibility.").put("originalInput", INPUT).put("domain", "Fitness").put("decisionType", "one_of_many")
                .put("template", "subscription").put("currency", "CNY").put("mode", "live").put("primaryFactorId", "total-cost");
        d.putArray("goals").addObject().put("text", "Keep costs low").put("source", "user_input").put("quote", "I care most about cost.");
        ObjectNode context = d.putObject("context"); context.set("months", known(4, "4 months")); context.set("usesPerMonth", unknown()); context.set("budgetCents", unknown());
        ArrayNode options = d.putArray("options");
        for (String id : new String[]{"annual", "monthly"}) {
            ObjectNode option = options.addObject().put("id", id).put("name", id.equals("annual") ? "Annual membership" : "Monthly membership").put("description", "Same service.").put("costsComplete", true);
            ObjectNode cost = option.putArray("costs").addObject().put("id", "membership").put("name", "Membership fee").put("cadence", id);
            cost.set("amount", known(id.equals("annual") ? 120000 : 15000, id.equals("annual") ? "CNY 1200" : "CNY 150"));
            option.set("minutesPerUse", unknown()); option.set("minutesPerMonth", unknown()); option.putArray("materials");
        }
        ArrayNode factors = d.putArray("factors");
        ObjectNode cost = factor("total-cost", "Total cost", "money").put("unit", "CNY").put("direction", "minimize").put("purpose", "preference").put("origin", "user").put("confirmed", true).put("userQuote", "I care most about cost.").put("ruleId", "total_cost");
        factors.add(cost); factors.add(factor("flexibility", "Flexible cancellation", "boolean")); factors.add(factor("access", "Access details", "text"));
        d.putArray("questions").add("How often would you visit each month?"); d.putArray("assumptions"); return d;
    }
    private ObjectNode factor(String id, String name, String type) {
        ObjectNode factor = mapper.createObjectNode().put("id", id).put("name", name).put("reason", "Relevant to the ongoing commitment.").put("dataType", type)
                .put("unit", "").put("direction", "none").put("purpose", "reference").put("importance", 3).put("origin", "model").put("confirmed", false);
        factor.putArray("optionIds").add("annual").add("monthly"); factor.putArray("allowedValues");
        factor.putObject("target").putNull("min").putNull("max").putNull("desired");
        ObjectNode values = factor.putObject("values"); values.set("annual", unknown()); values.set("monthly", unknown()); return factor;
    }
    private ObjectNode suggestions(ObjectNode decision) {
        ObjectNode out = mapper.createObjectNode().put("decisionId", "gym-choice").put("decisionVersion", 1);
        ObjectNode factor = factor("cat", "Pet access", "boolean").put("purpose", "hard").put("direction", "target").put("origin", "user").put("confirmed", true).put("userQuote", "I need to bring my cat.");
        ((ObjectNode) factor.path("target")).put("desired", true);
        out.putArray("factors").add(factor); out.putArray("questions"); return out;
    }
    private ObjectNode withMaterials() {
        ObjectNode decision = decision();
        ArrayNode materials = (ArrayNode) decision.path("options").get(0).path("materials");
        materials.addObject().put("id", "ad").put("title", "Advertisement").put("text", "Only today! Annual price CNY 1200. Cancel any time.");
        materials.addObject().put("id", "terms").put("title", "Terms").put("text", "Annual price CNY 1300. No cancellation for 12 months."); return decision;
    }
    private ObjectNode analysis() {
        ObjectNode result = mapper.createObjectNode().put("decisionId", "gym-choice").put("decisionVersion", 1).put("optionId", "annual").put("status", "inconsistent");
        ObjectNode finding = result.putArray("findings").addObject().put("id", "price-conflict").put("optionId", "annual").put("explanation", "The quoted annual prices differ; confirm which terms apply.").put("needsVerification", true);
        finding.putArray("materialIds").add("ad").add("terms"); finding.putArray("labels").add("conflict").add("unclear_price");
        ArrayNode quotes = finding.putArray("quotes"); quotes.addObject().put("materialId", "ad").put("quote", "Annual price CNY 1200."); quotes.addObject().put("materialId", "terms").put("quote", "Annual price CNY 1300.");
        result.putArray("extractions").addObject().put("id", "new-price").put("optionId", "annual").put("materialId", "terms").put("quote", "Annual price CNY 1300.")
                .put("label", "Annual price from terms").put("value", 130000).put("unit", "CNY").put("costId", "membership").putNull("factorId");
        ObjectNode urgency = ((ArrayNode) result.path("findings")).addObject().put("id", "urgency").put("optionId", "annual").put("explanation", "The wording creates a same-day deadline; this does not establish deception.").put("needsVerification", true);
        urgency.putArray("materialIds").add("ad"); urgency.putArray("quotes").addObject().put("materialId", "ad").put("quote", "Only today!"); urgency.putArray("labels").add("urgency");
        result.putArray("limitations").add("No external verification was performed."); return result;
    }
    static class FakeModel implements ModelClient {
        final ArrayDeque<Object> replies = new ArrayDeque<>();
        final List<List<Message>> calls = new ArrayList<>();
        void reply(Object... outputs) { for (Object output : outputs) replies.add(output); }
        @Override public String complete(List<Message> messages) {
            calls.add(List.copyOf(messages)); Object next = replies.remove();
            if (next instanceof RuntimeException exception) throw exception; return next.toString();
        }
        @Override public boolean configured() { return true; }
    }
}
