package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class QualitativeFlowTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @Test
    void acceptsTheExactFrontendQualitativeRequestWithoutSyntheticTotals() throws Exception {
        ObjectNode request = request();
        JsonNode original = request.deepCopy();
        validator.request(request);
        model.reply(draft());

        JsonNode story = service.story(request);

        assertEquals("qualitative", story.path("mode").asText());
        assertEquals("laptop-choice-demo", story.path("decisionId").asText());
        assertEquals(2, story.path("simulationVersion").asInt());
        assertEquals(0, story.path("monthlyReflections").size());
        String[] keys = {"beginning", "during", "later"};
        for (int i = 0; i < keys.length; i++) {
            JsonNode moment = story.path("moments").get(i);
            assertEquals(keys[i], moment.path("key").asText());
            assertEquals("gaming", moment.path("options").get(0).path("optionId").asText());
            assertEquals("office", moment.path("options").get(1).path("optionId").asText());
        }
        assertFalse(story.toString().contains("monthlyCost"));
        assertFalse(story.toString().contains("monthlyTime"));
        assertEquals(original, request);
        assertEquals(1, model.requests.size());
        validator.response(story, request);
    }

    @Test
    void projectsOnlyEnabledOptionSpecificFactorsAndNeutralBackground() throws Exception {
        ObjectNode request = request();
        ((ObjectNode) request.path("snapshot").path("decision")).put("originalInput", "Do not send this raw input.");
        model.reply(draft());
        service.story(request);
        JsonNode input = mapper.readTree(model.requests.getFirst().get(1).content());

        assertEquals(request.path("facts"), input.path("facts"));
        assertEquals(request.path("snapshot").path("decision").path("description"), input.path("background").path("description"));
        assertEquals(2, input.path("optionA").path("selectedConsiderations").size());
        assertEquals(2, input.path("optionB").path("selectedConsiderations").size());
        assertTrue(input.path("optionA").path("selectedConsiderations").get(0).path("consideration").asText().contains("work and leisure could share"));
        assertTrue(input.path("optionB").path("selectedConsiderations").get(0).path("consideration").asText().contains("performance has not been established"));
        assertFalse(input.toString().contains("Keeping work and leisure separate"));
        assertFalse(input.toString().contains("Do not send this raw input"));
        for (String field : List.of("snapshot", "calculation", "schemaVersion", "enabledTagIds", "simulationVersion", "fixedCosts", "activities", "recurringItems", "minutesPerEvent", "costCentsPerEvent")) {
            assertFalse(input.toString().contains("\"" + field + "\""), "Unexpected field: " + field);
        }
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("conditional user concerns"));
        assertTrue(prompt.contains("Do not introduce unselected factors"));
        assertTrue(prompt.contains("beginning:string,during:string,later:string,advice:string"));
    }

    @Test
    void permitsNoSelectedFactorsWithoutInventingDefaults() throws Exception {
        ObjectNode request = request();
        ((ArrayNode) request.path("snapshot").path("enabledTagIds")).removeAll();
        validator.request(request);
        JsonNode input = new StoryModelInput(mapper).project(request);
        assertEquals(0, input.path("optionA").path("selectedConsiderations").size());
        assertEquals(0, input.path("optionB").path("selectedConsiderations").size());
        assertFalse(input.toString().contains("Gaming in your free time"));
    }

    @Test
    void generatesATwoFactorLaptopDecisionWithoutNumericInputs() throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ((ArrayNode) decision.path("tags")).remove(2);
        model.reply(decision);

        JsonNode generated = service.scenario("  Should I buy a gaming laptop or an office laptop?  ");

        assertEquals(2, generated.path("schemaVersion").asInt());
        assertEquals("qualitative", generated.path("comparisonMode").asText());
        assertEquals(2, generated.path("tags").size());
        for (JsonNode option : generated.path("options")) {
            assertTrue(option.path("fixedCosts").isEmpty());
            assertTrue(option.path("activities").isEmpty());
        }
        assertEquals("Should I buy a gaming laptop or an office laptop?", generated.path("originalInput").asText());
        assertEquals(1, model.requests.size());
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("Missing numbers alone do NOT force qualitative mode"));
        assertTrue(prompt.contains("Annual versus monthly contracts"));
        assertTrue(prompt.contains("Do not divide annual or upfront payments"));
        assertTrue(prompt.contains("QQQ versus CD"));
        assertTrue(prompt.contains("Choose their number dynamically"));
        assertFalse(prompt.contains("2 to 3"));
        assertFalse(prompt.contains("4 to 8"));
        assertFalse(prompt.contains("9 to 20"));
        assertTrue(prompt.contains("hard limit is 30"));
        assertTrue(prompt.contains("relevant independent concerns"));
        assertFalse(prompt.contains("Return 5 to 10"));
    }

    @Test
    void repairsCapturedAnnualPaymentMisclassificationWithoutChangingItsAmounts() throws Exception {
        ObjectNode annual = fixture("annual-generated-monthly-invalid.json");
        ObjectNode corrected = annual.deepCopy().put("comparisonMode", "subscription");
        makeConsiderationsConditional(corrected);
        for (int i = 0; i < 2; i++) {
            ObjectNode option = (ObjectNode) corrected.path("options").get(i);
            JsonNode payment = option.path("fixedCosts").get(0).path("amountCentsMonthly").deepCopy();
            ((ArrayNode) option.path("fixedCosts")).removeAll();
            option.putObject("subscriptionCosts").put("periodMonths", i == 0 ? 12 : 1).set("paymentCents", payment);
        }
        ArrayNode factors = (ArrayNode) corrected.path("tags");
        factors.add(factors.get(0).deepCopy());
        ((ObjectNode) factors.get(3)).put("id", "changing-needs");
        factors.add(factors.get(1).deepCopy());
        ((ObjectNode) factors.get(4)).put("id", "renewal-terms");
        model.reply(annual, corrected);

        JsonNode result = service.scenario("Should I get a year-long gym membership or a monthly one");

        assertEquals("subscription", result.path("comparisonMode").asText());
        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("explicitly annual or upfront, not monthly"));
        assertTrue(model.requests.get(1).getLast().content().contains("do not relabel, divide, or amortize"));
        for (JsonNode option : result.path("options")) assertTrue(option.path("fixedCosts").isEmpty());
        assertTrue(annual.path("options").get(0).path("fixedCosts").get(0).path("amountCentsMonthly").path("value").isNull());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Annual membership fee", "Yearly fee", "Fee per year", "Year-long membership price", "Monthly equivalent of annual membership fee", "Upfront purchase cost", "One-time moving fee"})
    void rejectsExplicitNonmonthlyChargesInNewlyGeneratedMonthlyDecisions(String label) throws Exception {
        ObjectNode decision = fixture("annual-generated-monthly-invalid.json");
        ((ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0)).put("name", label);
        ContractValidator.ContractException error = assertThrows(ContractValidator.ContractException.class,
                () -> contract.generatedDecision(decision));
        assertEquals("decision.options[0].fixedCosts[0].amountCentsMonthly", error.path());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Monthly membership fee", "Annual plan monthly payment", "Year-long plan billed monthly", "Monthly installment for an annual plan"})
    void preservesActualMonthlyChargesEvenWhenAnOptionHasAnAnnualContract(String label) throws Exception {
        ObjectNode decision = fixture("annual-generated-monthly-invalid.json");
        makeConsiderationsConditional(decision);
        decision.put("originalInput", "Compare Gym A and Gym B monthly fees.");
        ((ObjectNode) decision.path("options").get(0).path("fixedCosts").get(0)).put("name", label);
        contract.generatedDecision(decision);
    }

    @Test
    void preservesLegacyMonthlyEquivalentValidation() throws Exception {
        ObjectNode decision = fixture("annual-generated-monthly-invalid.json");
        decision.put("schemaVersion", 1).remove("comparisonMode");
        ((ArrayNode) decision.path("tags")).removeAll();
        contract.decision(decision);
    }

    @ParameterizedTest
    @ValueSource(strings = {"You begin with one option and consider the other path.", "First, consider the selected needs.", "These two paths face the same selected circumstances."})
    void acceptsQualitativeStructuralLanguageWithoutNumericMeasurements(String text) throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("sharedScenario")).put("description", text);
        model.reply(draft);
        service.story(request());
        assertEquals(1, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Typically heavier and bulkier, may be less convenient to transport.", "Can handle demanding games, video editing, 3D rendering, and heavy multitasking.", "Sufficient for office software.", "The investment provides dependable returns."})
    void repairsGeneratedCategoryAssertionsIntoConditionalConcerns(String assertion) throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ObjectNode target = (ObjectNode) decision.path("tags").get(0).path("targets").get(0);
        target.put("consideration", assertion);
        ObjectNode corrected = decision.deepCopy();
        ((ObjectNode) corrected.path("tags").get(0).path("targets").get(0))
                .put("consideration", "Does the actual option meet this selected need?");
        model.reply(decision, corrected);

        JsonNode result = service.scenario("Should I buy a gaming laptop or an office laptop?");

        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("Rewrite every asserted category assumption"));
        assertEquals("Does the actual option meet this selected need?", result.path("tags").get(0).path("targets").get(0).path("consideration").asText());
    }

    @Test
    void generatedOnlyGroundingRuleDoesNotRejectLoadedOrEditedConsiderations() throws Exception {
        ObjectNode request = request();
        ((ObjectNode) request.path("snapshot").path("decision").path("tags").get(0).path("targets").get(0))
                .put("consideration", "An existing user-edited concern.");
        validator.request(request);
    }

    @ParameterizedTest
    @ValueSource(strings = {"3D", "Nasdaq-100", "120Hz", "$999", "10%"})
    void identifiesTheExactDigitBearingLiteralForBoundedStoryRepair(String token) throws Exception {
        ObjectNode invalid = draft();
        ((ObjectNode) invalid.path("optionA")).put("during", "You consider " + token + " for the selected need.");
        model.reply(invalid, draft());

        JsonNode result = service.story(request());

        assertEquals("qualitative", result.path("mode").asText());
        assertEquals(2, model.requests.size());
        String repair = model.requests.get(1).getLast().content();
        assertTrue(repair.contains("Found literal '" + token + "'"));
        assertTrue(repair.contains("Do not repeat the literal or invent a fact ID"));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 2, 3, 12, 20, 30})
    void acceptsQualityDrivenV2TagCounts(int count) throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ObjectNode sample = (ObjectNode) decision.path("tags").get(0).deepCopy();
        ArrayNode tags = (ArrayNode) decision.path("tags");
        tags.removeAll();
        for (int i = 0; i < count; i++) tags.add(sample.deepCopy().put("id", "factor-" + i));
        contract.generatedDecision(decision);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-mode", "bad-mode", "quantified-baseline", "activity-baseline", "numeric-tag", "unknown-option", "duplicate-target", "missing-consideration", "empty-consideration", "numeric-consideration", "unexpected-cost", "empty-group", "too-many-tags", "legacy-consideration", "legacy-mode"})
    void rejectsInvalidVersionedQualitativeContracts(String defect) throws Exception {
        ObjectNode decision = (ObjectNode) request().path("snapshot").path("decision");
        ObjectNode tag = (ObjectNode) decision.path("tags").get(0);
        ObjectNode target = (ObjectNode) tag.path("targets").get(0);
        switch (defect) {
            case "missing-mode" -> decision.remove("comparisonMode");
            case "bad-mode" -> decision.put("comparisonMode", "guess");
            case "quantified-baseline" -> ((ArrayNode) decision.path("options").get(0).path("fixedCosts")).addObject();
            case "activity-baseline" -> ((ArrayNode) decision.path("options").get(0).path("activities")).addObject();
            case "numeric-tag" -> tag.put("type", "fixed");
            case "unknown-option" -> target.put("optionId", "absent");
            case "duplicate-target" -> ((ObjectNode) tag.path("targets").get(1)).put("optionId", "gaming");
            case "missing-consideration" -> target.remove("consideration");
            case "empty-consideration" -> target.put("consideration", " ");
            case "numeric-consideration" -> target.put("consideration", 3);
            case "unexpected-cost" -> target.put("costCentsMonthly", 0);
            case "empty-group" -> tag.put("group", " ");
            case "too-many-tags" -> {
                ArrayNode tags = (ArrayNode) decision.path("tags");
                while (tags.size() < 31) tags.add(tag.deepCopy().put("id", "factor-" + tags.size()));
            }
            case "legacy-consideration" -> {
                decision.put("schemaVersion", 1).remove("comparisonMode");
                for (JsonNode item : decision.path("tags")) ((ObjectNode) item).remove("group");
            }
            case "legacy-mode" -> decision.put("schemaVersion", 1);
            default -> throw new IllegalArgumentException(defect);
        }
        assertThrows(ContractValidator.ContractException.class, () -> contract.decision(decision));
    }

    @ParameterizedTest
    @ValueSource(strings = {"unknown-tag", "duplicate-tag", "bad-version", "numeric-status", "synthetic-totals", "synthetic-options", "numeric-fact", "unknown-fact", "missing-name", "wrong-name", "wrong-context", "extra-context", "extra-snapshot"})
    void rejectsUntrustedQualitativeRequestsBeforeAnyModelCall(String defect) throws Exception {
        ObjectNode request = request();
        ObjectNode snapshot = (ObjectNode) request.path("snapshot");
        ObjectNode calculation = (ObjectNode) snapshot.path("calculation");
        ObjectNode facts = (ObjectNode) request.path("facts");
        switch (defect) {
            case "unknown-tag" -> ((ArrayNode) snapshot.path("enabledTagIds")).add("absent");
            case "duplicate-tag" -> ((ArrayNode) snapshot.path("enabledTagIds")).add("gaming-time");
            case "bad-version" -> snapshot.put("simulationVersion", -1);
            case "numeric-status" -> calculation.put("status", "valid");
            case "synthetic-totals" -> calculation.put("totalCostCents", 0);
            case "synthetic-options" -> calculation.putArray("options");
            case "numeric-fact" -> facts.put("optionA_monthlyCost", "$0.00");
            case "unknown-fact" -> facts.put("batteryLife", "long");
            case "missing-name" -> facts.remove("optionA_name");
            case "wrong-name" -> facts.put("optionA_name", "An unrelated option");
            case "wrong-context" -> ((ObjectNode) request.path("context")).put("mode", "general");
            case "extra-context" -> ((ObjectNode) request.path("context")).put("arrivalTime", "09:00");
            case "extra-snapshot" -> snapshot.put("forecast", "made up");
            default -> throw new IllegalArgumentException(defect);
        }
        ApiException error = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", error.code());
        assertEquals(0, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"The battery lasts 10 hours.", "The cost is {{optionA_monthlyCost}}.", "It ranks {{inventedRank}}.", "The choice is {{optionA_name}."})
    void repairsUnsupportedQualitativeClaimsOnlyOnce(String text) throws Exception {
        ObjectNode draft = draft();
        ((ObjectNode) draft.path("optionA")).put("during", text);
        model.reply(draft, draft);
        ApiException error = assertThrows(ApiException.class, () -> service.story(request()));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
        assertEquals(model.requests.get(0).get(1).content(), model.requests.get(1).get(1).content());
    }

    @Test
    void retainsPlaceholdersForDigitBearingOptionNames() throws Exception {
        ObjectNode request = request();
        ((ObjectNode) request.path("snapshot").path("decision").path("options").get(0)).put("name", "Gaming laptop 2026");
        ((ObjectNode) request.path("facts")).put("optionA_name", "Gaming laptop 2026");
        model.reply(draft());
        JsonNode story = service.story(request);
        assertTrue(story.path("moments").get(0).path("options").get(0).path("text").asText().contains("{{optionA_name}}"));
        assertFalse(story.toString().contains("2026"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"mode", "moment", "reflection", "identity", "version", "option-order"})
    void rejectsWrongQualitativeStoryMetadataRatherThanOverwritingIt(String defect) throws Exception {
        ObjectNode request = request();
        ObjectNode response = (ObjectNode) new StoryDraftAssembler(mapper, contract).assemble(draft(), request);
        switch (defect) {
            case "mode" -> response.remove("mode");
            case "moment" -> ((ObjectNode) response.path("moments").get(0)).put("key", "morning");
            case "reflection" -> ((ArrayNode) response.path("monthlyReflections")).addObject().put("optionId", "gaming").put("text", "An invented monthly result.");
            case "identity" -> response.put("decisionId", "different-choice");
            case "version" -> response.put("simulationVersion", 99);
            case "option-order" -> ((ObjectNode) response.path("moments").get(0).path("options").get(0)).put("optionId", "office");
            default -> throw new IllegalArgumentException(defect);
        }
        model.reply(response, response);
        ApiException error = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
    }

    @Test
    void mixedConsiderationsLeaveQuantitativeResultsUnchangedAndRemainSelectedOnly() throws Exception {
        ObjectNode request = fixture("story-general-request.json");
        ObjectNode snapshot = (ObjectNode) request.path("snapshot");
        ObjectNode decision = (ObjectNode) snapshot.path("decision");
        JsonNode originalCalculation = snapshot.path("calculation").deepCopy();
        JsonNode originalFacts = request.path("facts").deepCopy();
        decision.put("schemaVersion", 2).put("comparisonMode", "quantitative");
        ArrayNode tags = (ArrayNode) decision.path("tags");
        ObjectNode consideration = tags.addObject().put("id", "quiet-space").put("type", "consideration")
                .put("name", "A quiet place to work").put("description", "Explore the need for quiet without assuming noise levels.");
        consideration.putArray("targets").addObject().put("optionId", "near")
                .put("consideration", "If quiet matters, check whether the actual home meets that need.");
        JsonNode unselected = new StoryModelInput(mapper).project(request);
        assertFalse(unselected.toString().contains("A quiet place to work"));
        ((ArrayNode) snapshot.path("enabledTagIds")).add("quiet-space");

        validator.request(request);
        JsonNode selected = new StoryModelInput(mapper).project(request);

        assertEquals(originalCalculation, snapshot.path("calculation"));
        assertEquals(originalFacts, request.path("facts"));
        assertEquals(1, selected.path("optionA").path("selectedConsiderations").size());
        assertFalse(selected.path("optionB").has("selectedConsiderations"));
        assertEquals(0, selected.path("optionA").path("enabledAdjustments").size());
        assertEquals(1, selected.path("optionB").path("enabledAdjustments").size());
    }

    private void makeConsiderationsConditional(ObjectNode decision) {
        for (JsonNode tag : decision.path("tags")) {
            if (!"consideration".equals(tag.path("type").asText())) continue;
            for (JsonNode target : tag.path("targets")) ((ObjectNode) target)
                    .put("consideration", "If this factor matters, check how the actual option meets that need.");
        }
    }

    private ObjectNode request() throws IOException {
        return fixture("story-qualitative-request.json");
    }

    private ObjectNode fixture(String file) throws IOException {
        try (var stream = getClass().getResourceAsStream("/" + file)) {
            return (ObjectNode) mapper.readTree(stream);
        }
    }

    private ObjectNode draft() throws IOException {
        return (ObjectNode) mapper.readTree("""
            {"sharedScenario":{"title":"Exploring either laptop","description":"The same selected work and leisure needs guide both paths."},
             "optionA":{"beginning":"You consider {{optionA_name}} against the selected needs.","during":"If you work away from home, the actual device would need to fit that setting.","later":"If your needs change, you could revisit how the device fits them."},
             "optionB":{"beginning":"You consider {{optionB_name}} against the selected needs.","during":"If you work away from home, the actual device would need to fit that setting.","later":"If your needs change, you could revisit how the device fits them."}}
            """);
    }

    private final class RecordingModel implements ModelClient {
        private final ArrayDeque<String> responses = new ArrayDeque<>();
        private final List<List<Message>> requests = new ArrayList<>();

        void reply(JsonNode... replies) throws IOException {
            for (JsonNode reply : replies) responses.add(mapper.writeValueAsString(reply));
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
