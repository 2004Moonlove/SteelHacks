package app.dayfork;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ChoiceServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private ChoiceValidator validator;
    private ObjectNode decision;
    @BeforeEach void setup() throws Exception {
        validator = new ChoiceValidator(mapper);
        decision = (ObjectNode) mapper.readTree("""
            {"schemaVersion":2,"id":"decision","version":7,"title":"Choose a workshop","description":"Fee is 120 USD. I need cats allowed.","domain":"new-domain","decisionType":"choose_one",
            "goals":[{"text":"Learn","basis":"explicit"}],"currency":"USD","context":{"months":null,"usesPerWeek":null,"budgetCents":null,"budgetScope":"total","source":{"kind":"unknown","note":"Not provided"}},
            "options":[{"id":"a","name":"Workshop A","description":"","materials":[]},{"id":"b","name":"Workshop B","description":"","materials":[]}],
            "factors":[{"id":"fee","name":"Fee","reason":"Compare cash needed","optionIds":["a","b"],"dataType":"money","unit":"USD","allowedValues":[],"direction":"lower","purpose":"preference","importance":3,"target":{},
            "values":{"a":{"value":12000,"source":{"kind":"user","note":"Quoted fee","quote":"120 USD"}},"b":{"value":null,"source":{"kind":"unknown","note":"Not provided"}}},
            "source":{"kind":"model_suggestion","note":"Relevant to spending"},"confirmed":false,"ruleId":"upfront"}],"primaryFactorId":null,"questions":["What is B's fee?"],"charts":["cost_bar"],"origin":"model"}
            """);
    }
    private ChoiceService service(String... replies) {
        return new ChoiceService(new ModelClient() { int i; public boolean configured() { return true; } public String complete(List<Message> messages) { return replies[Math.min(i++, replies.length - 1)]; } }, mapper, validator);
    }
    private ObjectNode request() { ObjectNode r = mapper.createObjectNode(); r.set("decision", decision); r.put("optionId", "a"); return r; }
    private void materials() {
        ((ObjectNode) decision.path("options").path(0)).putArray("materials").addObject().put("id", "ad").put("title", "Ad").put("text", "Only today. Fee is 120 USD.");
        ((ObjectNode) decision.path("options").path(0).path("materials").path(0)).put("text", "Only today. Fee is 120 USD.");
    }
    private ObjectNode analysis() throws Exception { return (ObjectNode) mapper.readTree("""
        {"decisionId":"decision","version":7,"optionId":"a","status":"needs_verification","findings":[{"id":"pressure","tags":["urgency","unclear_terms"],"explanation":"Check whether the deadline applies.","evidence":[{"materialId":"ad","quote":"Only today."}]}],"extracted":[{"factorId":"fee","value":12000,"unit":"USD","materialId":"ad","quote":"120 USD","note":"Confirm applicable price"}]}
        """); }
    @Test void acceptsOpenDomainAndPreservesMissingValues() { validator.decision(decision); assertTrue(decision.path("factors").path(0).path("values").path("b").path("value").isNull()); }
    @Test void normalizesLiveOriginAndRequiresReview() { ((ObjectNode) decision.path("factors").path(0)).put("confirmed", true); JsonNode output = service(decision.toString()).understand(mapper.createObjectNode().put("description", decision.path("description").asText())); assertEquals("model", output.path("origin").asText()); assertEquals(0, output.path("version").asInt()); assertFalse(output.path("factors").path(0).path("confirmed").asBoolean()); }
    @Test void repairsMalformedJsonExactlyOnce() {
        var calls = new AtomicInteger(); var model = new ModelClient() { public boolean configured() { return true; } public String complete(List<Message> messages) { return calls.getAndIncrement() == 0 ? "not JSON" : decision.toString(); } };
        new ChoiceService(model, mapper, validator).understand(mapper.createObjectNode().put("description", decision.path("description").asText())); assertEquals(2, calls.get());
    }
    @Test void failsAfterOneRepairWithoutFixtureFallback() { ApiException e = assertThrows(ApiException.class, () -> service("{}").understand(mapper.createObjectNode().put("description", "Which workshop?"))); assertEquals("MODEL_OUTPUT_INVALID", e.code()); }
    @Test void doesNotTurnSuggestedRequirementsIntoHardConstraints() { ObjectNode f = (ObjectNode) decision.path("factors").path(0); f.put("purpose", "hard"); ApiException e = assertThrows(ApiException.class, () -> service(decision.toString()).understand(mapper.createObjectNode().put("description", "Fee is 120 USD."))); assertEquals("MODEL_OUTPUT_INVALID", e.code()); }
    @Test void retainsExplicitHardRequirementWithSupportingQuote() {
        ObjectNode f = (ObjectNode) decision.path("factors").path(0); f.put("purpose", "hard"); f.put("dataType", "boolean"); f.put("ruleId", (String) null); f.put("direction", "target"); f.put("unit", ""); f.putObject("target").put("equals", true); f.putObject("source").put("kind", "user").put("note", "Explicit need").put("quote", "I need cats allowed."); ((ObjectNode) f.path("values").path("a")).putNull("value");
        JsonNode output = service(decision.toString()).understand(mapper.createObjectNode().put("description", "I need cats allowed.")); assertEquals("hard", output.path("factors").path(0).path("purpose").asText()); assertTrue(output.path("factors").path(0).path("values").path("a").path("value").isNull());
    }
    @Test void rejectsKnownValuesWithoutAUserQuote() { ((ObjectNode) decision.path("factors").path(0).path("values").path("a").path("source")).put("quote", "invented quote"); assertThrows(ApiException.class, () -> service(decision.toString()).understand(mapper.createObjectNode().put("description", "Which one?"))); }
    @Test void rejectsCrossOptionEvidence() throws Exception { materials(); ObjectNode a = analysis(); ((ObjectNode) a.path("findings").path(0).path("evidence").path(0)).put("materialId", "other-option"); assertThrows(IllegalArgumentException.class, () -> validator.analysis(a, decision, "a")); }
    @Test void acceptsMultiTagEvidenceAndNeverOverwritesFacts() throws Exception { materials(); String before = decision.toString(); JsonNode a = service(analysis().toString()).materials(request()); assertEquals(2, a.path("findings").path(0).path("tags").size()); assertEquals(before, decision.toString()); }
    @Test void rejectsFabricatedQuotesAndStaleVersions() throws Exception { materials(); ObjectNode a = analysis(); a.put("version", 6); assertThrows(IllegalArgumentException.class, () -> validator.analysis(a, decision, "a")); a.put("version", 7); ((ObjectNode) a.path("extracted").path(0)).put("quote", "Made up"); assertThrows(IllegalArgumentException.class, () -> validator.analysis(a, decision, "a")); }
    @Test void requiresTwoDocumentsForCrossMaterialConflict() throws Exception { materials(); ObjectNode a = analysis(); a.put("status", "inconsistent"); ((ObjectNode) a.path("findings").path(0)).putArray("tags").add("conflict"); assertThrows(IllegalArgumentException.class, () -> validator.analysis(a, decision, "a")); }
    @Test void validatesStatusesIndependentlyOfModelClaims() throws Exception { materials(); ObjectNode a = analysis(); a.put("status", "no_pressure"); assertThrows(IllegalArgumentException.class, () -> validator.analysis(a, decision, "a")); }
    @Test void noMaterialsDoesNotCallModel() { var model = new ModelClient() { public boolean configured() { return true; } public String complete(List<Message> messages) { fail("No model call expected"); return ""; } }; assertEquals("NO_MATERIALS", assertThrows(ApiException.class, () -> new ChoiceService(model, mapper, validator).materials(request())).code()); }
    @Test void factorSuggestionsCarryTheExactVersion() { ObjectNode response = mapper.createObjectNode(); response.put("decisionId", "decision"); response.put("version", 6); response.set("factors", decision.path("factors")); response.putArray("questions"); assertThrows(IllegalArgumentException.class, () -> validator.factors(response, decision)); }
    @Test void rejectsNegativeRuleValuesAndMismatchedUnits() { ObjectNode f = (ObjectNode) decision.path("factors").path(0); ((ObjectNode) f.path("values").path("a")).put("value", -1); assertThrows(IllegalArgumentException.class, () -> validator.decision(decision)); ((ObjectNode) f.path("values").path("a")).put("value", 12000); f.put("unit", "CNY"); assertThrows(IllegalArgumentException.class, () -> validator.decision(decision)); }
    @Test void rejectsWrongTargetTypes() {
        ((ObjectNode) decision.path("factors").path(0).path("target")).put("equals", "soon");
        assertThrows(IllegalArgumentException.class, () -> validator.decision(decision));
    }
    @Test void acceptsClearlyDisclosedNormalMarketing() throws Exception {
        materials(); ObjectNode a = analysis(); a.put("status", "no_pressure"); a.putArray("extracted");
        ((ObjectNode) a.path("findings").path(0)).putArray("tags").add("normal_marketing").add("clear_disclosure");
        validator.analysis(a, decision, "a");
    }
    @Test void rejectsExtraExecutableFields() { decision.put("script", "alert(1)"); assertThrows(IllegalArgumentException.class, () -> validator.decision(decision)); }
}

