package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class LiveSemanticRegressionTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator validator = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private final RecordingModel model = new RecordingModel();
    private final GenerationService service = new GenerationService(model, mapper, contract, validator);

    @Test
    void repairsTheCapturedOppositeOptionTargetsWithoutChangingPayments() throws Exception {
        ObjectNode bad = fixture("subscription-reversed-targets-invalid.json");
        ObjectNode repaired = correctTargets(bad.deepCopy());
        contract.decision(bad); // Loaded older data does not acquire generation-only semantic restrictions.
        var failure = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(bad));
        assertEquals("decision.tags[0].targets[0].consideration", failure.path());
        model.reply(bad, repaired);
        JsonNode result = service.scenario(bad.path("originalInput").asText());
        assertEquals(repaired.path("options"), result.path("options"));
        assertEquals(2, model.requests.size());
        String repair = model.requests.get(1).getLast().content();
        assertTrue(repair.contains("opposing option"));
        assertTrue(repair.contains("same shared condition"));
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("do not replace full annual renewals with a year card plus a month card"));
    }

    @ParameterizedTest
    @CsvSource({"0,0", "0,1", "3,0", "3,1"})
    void eachObservedSwappedTargetIsRejectedIndependently(int tag, int target) throws Exception {
        ObjectNode original = fixture("subscription-reversed-targets-invalid.json");
        ObjectNode candidate = correctTargets(original.deepCopy());
        ((ObjectNode) candidate.path("tags").get(tag).path("targets").get(target))
                .set("consideration", original.path("tags").get(tag).path("targets").get(target).path("consideration"));
        assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(candidate));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "Year Card|Month Card|If the budget is tight, how would Year Card compare with Month Card?",
            "A|B|If a budget is tight, how would this arrangement fit?",
            "Plan|Plan Plus|If using Plan Plus is attractive, how would it fit this need?",
            "Laptop|Desktop|If a desktop-like setup matters, how could this Laptop fit?"})
    void permitsOwnOptionComparisonsAndAvoidsShortOrSubstringMatches(String otherName, String ownName, String text) throws Exception {
        ObjectNode candidate = correctTargets(fixture("subscription-reversed-targets-invalid.json"));
        ((ObjectNode) candidate.path("options").get(0)).put("name", ownName);
        ((ObjectNode) candidate.path("options").get(1)).put("name", otherName);
        candidate.putArray("tags").addObject().put("id", "target").put("name", "Fit").put("description", "Explore fit.")
                .put("type", "consideration").putArray("targets").addObject().put("optionId", "year_card").put("consideration", text);
        candidate.put("originalInput", "Compare these plans; only focus on fit.");
        contract.generatedDecision(candidate);
    }

    @Test
    void capturedSubscriptionStoryUsesOneRepairForUnsupportedSkipRights() throws Exception {
        ObjectNode request = fixture("story-subscription-request.json");
        ObjectNode bad = fixture("subscription-rights-and-window-invalid-draft.json");
        model.reply(bad, correctedDraft(bad.deepCopy()));
        JsonNode result = service.story(request);
        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("Pause, skip, cancel, or stop permissions were not supplied"));
        assertTrue(result.path("moments").get(1).path("options").get(1).path("text").asText().contains("if the actual terms permit"));
        assertTrue(result.path("sharedScenario").path("description").asText().contains("{{subscriptionCostComparison}}"));
        String prompt = model.requests.getFirst().getFirst().content();
        assertTrue(prompt.contains("single external event applying to both paths"));
        assertTrue(prompt.contains("do not make the annual branch attend steadily while the monthly branch becomes busier"));
        assertTrue(prompt.contains("Advice about changing, pausing, or cancelling service must first confirm"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "If your schedule changes, you can choose to skip a month.",
            "You could pause the membership when work gets busy.",
            "You may cancel your plan whenever it no longer suits your schedule.",
            "If terms permit, you might change your arrangement. You can skip a month.",
            "At the end of the comparison window you have paid the total for {{optionB_paymentCount}} months and stop the subscription because you no longer need access."})
    void rejectsUnprovidedContractRightsAndWindowEndAssumptions(String text) throws Exception {
        ObjectNode request = fixture("story-subscription-request.json");
        ObjectNode draft = correctedDraft(fixture("subscription-rights-and-window-invalid-draft.json"));
        ((ObjectNode) draft.path("optionB")).put("later", text);
        JsonNode story = new StoryDraftAssembler(mapper, contract).assemble(draft, request);
        var error = assertThrows(ContractValidator.ContractException.class, () -> validator.response(story, request));
        assertEquals("story.moments[2].options[1].text", error.path());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "If the actual terms permit, you can choose to skip a month while your schedule is busy.",
            "You could pause the membership, subject to the actual contract terms.",
            "You may cancel your plan if the cancellation policy allows this.",
            "At the end of the comparison window, you review whether you still need access while the routine may continue.",
            "The comparison window ends while your access remains available under the modeled coverage.",
            "On a possible busy day, you could stop by the gym as your routine allows.",
            "You can pause to look at your calendar before planning your routine.",
            "If the busy period happens, you may skip a workout while access remains unchanged."})
    void acceptsConditionalRightsAndOngoingNeedsWithoutChangingTotals(String text) throws Exception {
        ObjectNode request = fixture("story-subscription-request.json");
        ObjectNode draft = correctedDraft(fixture("subscription-rights-and-window-invalid-draft.json"));
        ((ObjectNode) draft.path("optionB")).put("later", text);
        validator.response(new StoryDraftAssembler(mapper, contract).assemble(draft, request), request);
    }

    @Test
    void theSameContractRightsGuardAppliesToPracticalAdvice() throws Exception {
        ObjectNode request = fixture("story-subscription-request.json");
        ObjectNode draft = correctedDraft(fixture("subscription-rights-and-window-invalid-draft.json"));
        ((ObjectNode) draft.path("optionA")).put("advice", "You can pause the membership when your schedule gets busy.");
        JsonNode story = new StoryDraftAssembler(mapper, contract).assemble(draft, request);
        var error = assertThrows(ContractValidator.ContractException.class, () -> validator.response(story, request));
        assertEquals("story.advice[0].text", error.path());
    }

    @Test
    void aRepeatedInvalidStoryExhaustsTheExistingBoundedRepair() throws Exception {
        ObjectNode bad = fixture("subscription-rights-and-window-invalid-draft.json");
        model.reply(bad, bad);
        var error = assertThrows(ApiException.class, () -> service.story(fixture("story-subscription-request.json")));
        assertEquals("MODEL_OUTPUT_INVALID", error.code());
        assertEquals(2, model.requests.size());
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2, 3, 4})
    void eachCapturedHousingBaselineEditorIsNotAnOptionalAdjustment(int index) throws Exception {
        ObjectNode housing = fixture("housing-duplicated-baseline-invalid.json");
        JsonNode tag = housing.path("tags").get(index).deepCopy();
        housing.putArray("tags").add(tag);
        housing.put("originalInput", "Live on campus or off campus; only focus on this factor.");
        contract.decision(housing);
        var error = assertThrows(ContractValidator.ContractException.class, () -> contract.generatedDecision(housing));
        assertEquals("decision.tags[0]", error.path());
        assertTrue(error.getMessage().contains("baseline"));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "1|Extra utilities above the allowance|Add only the charge exceeding the included utilities allowance.",
            "3|Grocery delivery subscription|An optional delivery membership billed separately from groceries.",
            "0|Rent insurance|An optional insurance policy billed separately from the housing payment.",
            "2|Extra campus visits|Add additional commute events beyond the scheduled baseline.",
            "4|Extra laundry loads|Add sessions beyond the baseline when a separate need arises."})
    void permitsDistinctServicesAndExplicitIncrementalEvents(int index, String name, String description) throws Exception {
        ObjectNode housing = fixture("housing-duplicated-baseline-invalid.json");
        ObjectNode tag = housing.path("tags").get(index).deepCopy();
        tag.put("name", name).put("description", description);
        housing.putArray("tags").add(tag);
        housing.put("originalInput", "Live on campus or off campus; only focus on this factor.");
        contract.generatedDecision(housing);
    }

    @Test
    void capturedHousingFailuresGetActionableRepairWithoutDroppingFactorCoverage() throws Exception {
        ObjectNode bad = fixture("housing-duplicated-baseline-invalid.json");
        ObjectNode corrected = bad.deepCopy();
        String[] names = {"Optional storage service", "Extra utilities above allowance", "Extra campus visits", "Grocery delivery subscription", "Extra laundry loads"};
        String[] descriptions = {"An optional separately billed storage service.", "Add only extra charges above the baseline allowance.",
                "Add additional visits beyond the existing commute.", "An optional delivery membership billed separately from groceries.", "Additional loads beyond the existing routine."};
        for (int i = 0; i < names.length; i++) ((ObjectNode) corrected.path("tags").get(i)).put("name", names[i]).put("description", descriptions[i]);
        model.reply(bad, corrected);
        JsonNode result = service.scenario(bad.path("originalInput").asText());
        assertEquals(9, result.path("tags").size());
        assertEquals(2, model.requests.size());
        assertTrue(model.requests.get(1).getLast().content().contains("never charge the baseline twice"));
        assertTrue(model.requests.getFirst().getFirst().content().contains("Rideshare some trips replaces existing trips"));
    }

    private ObjectNode correctTargets(ObjectNode decision) {
        for (JsonNode tag : decision.path("tags")) {
            for (JsonNode target : tag.path("targets")) {
                String name = target.path("optionId").asText().equals("year_card") ? "Year Card" : "Month Card";
                ((ObjectNode) target).put("consideration", "If your schedule changes, how would " + name + " fit the same changing routine under its actual terms?");
            }
        }
        return decision;
    }

    private ObjectNode correctedDraft(ObjectNode draft) {
        ((ObjectNode) draft.path("sharedScenario")).put("description", "Imagine the same busy period changing your routine under either arrangement.");
        ((ObjectNode) draft.path("optionA")).put("during", "If that busy period happens, you return when your schedule allows while the prepaid access remains available.")
                .put("later", "As your routine settles, you prepare for the modeled renewal while your needs may continue beyond the comparison window.");
        ((ObjectNode) draft.path("optionB")).put("during", "If that same busy period happens, you return when your schedule allows; you can choose to skip a month only if the actual terms permit, without treating this possibility as a change to the modeled payments.")
                .put("later", "As your routine settles, you prepare for the next renewal while your needs may continue beyond the comparison window.")
                .put("advice", "Confirm the notice and cancellation terms before deciding whether to change the arrangement at renewal.");
        return draft;
    }

    private ObjectNode fixture(String name) throws Exception {
        try (var stream = getClass().getResourceAsStream("/" + name)) { return (ObjectNode) mapper.readTree(stream); }
    }

    private final class RecordingModel implements ModelClient {
        final ArrayDeque<String> responses = new ArrayDeque<>();
        final List<List<Message>> requests = new ArrayList<>();
        void reply(JsonNode... values) throws Exception { for (JsonNode value : values) responses.add(mapper.writeValueAsString(value)); }
        @Override public String complete(List<Message> messages) { requests.add(List.copyOf(messages)); return responses.remove(); }
        @Override public boolean configured() { return true; }
    }
}
