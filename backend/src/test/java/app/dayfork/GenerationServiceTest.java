package app.dayfork;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayDeque;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class GenerationServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final FakeModelClient model = new FakeModelClient();
    private final ContractValidator contract = new ContractValidator();
    private final StoryValidator stories = new StoryValidator(contract, new SimulationReconciler(contract, mapper));
    private GenerationService service;

    @BeforeEach
    void setUp() {
        service = new GenerationService(model, mapper, contract, stories);
    }

    @Test
    void repairsMalformedScenarioOnlyOnceAndPreservesUserInput() {
        model.reply("not JSON", validDecision());
        JsonNode decision = service.scenario("  live near campus or farther away  ");
        assertEquals("live near campus or farther away", decision.path("originalInput").asText());
        assertEquals(5, decision.path("tags").size());
        assertEquals(2, model.calls);
    }

    @Test
    void doesNotRepairTransportFailures() {
        model.reply(new ApiException(HttpStatus.GATEWAY_TIMEOUT,
                "MODEL_UNAVAILABLE", "The model service is unavailable."));
        ApiException exception = assertThrows(ApiException.class, () -> service.scenario("Option A or B"));
        assertEquals("MODEL_UNAVAILABLE", exception.code());
        assertEquals(1, model.calls);
    }

    @Test
    void rejectsBadScenarioAfterOneRepair() {
        model.reply("{}", "{}");
        ApiException exception = assertThrows(ApiException.class, () -> service.scenario("Option A or B"));
        assertEquals("MODEL_OUTPUT_INVALID", exception.code());
        assertEquals(2, model.calls);
    }

    @Test
    void validatesStoryFactReferencesAndRepairsOutput() throws Exception {
        String invalid = validStory().replace("{{optionA_monthlyCost}}", "{{inventedFact}}");
        model.reply(invalid, validStory());
        JsonNode result = service.story(validStoryRequest());
        assertEquals("decision-1", result.path("decisionId").asText());
        assertEquals(2, model.calls);
    }

    @Test
    void rejectsContradictoryStoryFactsBeforeModelCall() throws Exception {
        JsonNode request = validStoryRequest();
        ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("facts")).put("optionA_monthlyCost", "$10.00");
        ApiException exception = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", exception.code());
        assertEquals(0, model.calls);
    }

    @Test
    void rejectsTamperedRentWithZeroTotalsAndBreakdown() throws Exception {
        JsonNode request = validStoryRequest();
        ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("snapshot").path("decision").path("options").get(0))
                .set("fixedCosts", mapper.readTree("""
                    [{"id":"rent","name":"Rent","amountCentsMonthly":{"value":150000,"source":"user_input"}}]
                    """));
        ApiException exception = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", exception.code());
        assertEquals(0, model.calls);
    }

    @Test
    void rejectsFabricatedFactEvenWhenOtherFactsMatch() throws Exception {
        JsonNode request = validStoryRequest();
        ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("facts")).put("unverifiedCost", "$999.00");
        ApiException exception = assertThrows(ApiException.class, () -> service.story(request));
        assertEquals("INVALID_REQUEST", exception.code());
        assertEquals(0, model.calls);
    }

    @Test
    void generatedDecisionCannotClaimUserEditsOrDemoAssumptions() {
        String fakeEdit = validDecision().replaceFirst("\\\"source\\\":\\\"user_input\\\"", "\"source\":\"user_edit\"");
        String fakeAssumption = validDecision().replaceFirst("\\\"source\\\":\\\"user_input\\\"",
                "\"source\":\"demo_assumption\",\"confirmed\":true,\"note\":\"Made up\"");
        model.reply(fakeEdit, fakeAssumption);
        ApiException exception = assertThrows(ApiException.class, () -> service.scenario("Option A or B"));
        assertEquals("MODEL_OUTPUT_INVALID", exception.code());
        assertEquals(2, model.calls);
    }

    @Test
    void validatesCampusTravelSelectionsAgainstCalculatedEvents() throws Exception {
        JsonNode request = validStoryRequest();
        JsonNode options = request.path("snapshot").path("decision").path("options");
        JsonNode results = request.path("snapshot").path("calculation").path("options");
        for (int i = 0; i < 2; i++) {
            int minutes = i == 0 ? 10 : 20;
            ((com.fasterxml.jackson.databind.node.ObjectNode) options.get(i)).set("activities", mapper.readTree("""
                [{"id":"commute","name":"Commute","eventUnit":"one_way_trip",
                  "eventsPerMonth":{"value":2,"source":"user_input"},
                  "costCentsPerEvent":{"value":0,"source":"user_input"},
                  "minutesPerEvent":{"value":%d,"source":"user_input"}}]
                """.formatted(minutes)));
            ((com.fasterxml.jackson.databind.node.ObjectNode) results.get(i)).put("totalTimeMinutes", minutes * 2);
            ((com.fasterxml.jackson.databind.node.ObjectNode) results.get(i)).set("breakdown", mapper.readTree("""
                [{"id":"%s:commute:original","kind":"original_activity","label":"Commute","activityId":"commute",
                  "eventsPerMonth":2,"costCentsPerEvent":0,"minutesPerEvent":%d,
                  "totalCostCents":0,"totalTimeMinutes":%d}]
                """.formatted(i == 0 ? "a" : "b", minutes, minutes * 2)));
        }
        ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("snapshot").path("calculation").path("comparison"))
                .put("timeDeltaMinutes", 20);
        ((com.fasterxml.jackson.databind.node.ObjectNode) request).set("context", mapper.readTree("""
            {"mode":"campus","arrivalTime":"09:00","departureTime":"21:00","selections":[
              {"optionId":"a","activityId":"commute","outboundChoiceId":"original:commute","inboundChoiceId":"original:commute"},
              {"optionId":"b","activityId":"commute","outboundChoiceId":"original:commute","inboundChoiceId":"original:commute"}
            ]}
            """));
        var facts = (com.fasterxml.jackson.databind.node.ObjectNode) request.path("facts");
        facts.put("optionA_monthlyTime", "0 hr 20 min");
        facts.put("optionB_monthlyTime", "0 hr 40 min");
        facts.put("monthlyTimeDifference", "0 hr 20 min");
        facts.put("optionA_leaveHome", "8:50 AM");
        facts.put("optionB_leaveHome", "8:40 AM");
        for (String prefix : new String[]{"optionA", "optionB"}) {
            facts.put(prefix + "_arriveCampus", "9:00 AM");
            facts.put(prefix + "_leaveCampus", "9:00 PM");
            facts.put(prefix + "_outboundMode", "Commute");
            facts.put(prefix + "_inboundMode", "Commute");
            facts.put(prefix + "_dayTravelCost", "$0.00");
        }
        facts.put("optionA_arriveHome", "9:10 PM");
        facts.put("optionB_arriveHome", "9:20 PM");
        facts.put("optionA_dayTravelTime", "0 hr 20 min");
        facts.put("optionB_dayTravelTime", "0 hr 40 min");
        stories.request(request);

        ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("context").path("selections").get(0))
                .put("outboundChoiceId", "missing");
        assertThrows(ContractValidator.ContractException.class, () -> stories.request(request));
    }

    private JsonNode validStoryRequest() throws Exception {
        return mapper.readTree("""
            {
              "snapshot": {
                "decision": %s,
                "enabledTagIds": [],
                "simulationVersion": 4,
                "calculation": {
                  "status": "valid",
                  "options": [
                    {"optionId":"a","totalCostCents":0,"totalTimeMinutes":0,"breakdown":[]},
                    {"optionId":"b","totalCostCents":0,"totalTimeMinutes":0,"breakdown":[]}
                  ],
                  "comparison":{"costDeltaCents":0,"timeDeltaMinutes":0}
                }
              },
              "context":{"mode":"general"},
              "facts":{
                "optionA_name":"Option A","optionB_name":"Option B",
                "optionA_monthlyCost":"$0.00","optionB_monthlyCost":"$0.00",
                "optionA_monthlyTime":"0 hr 0 min","optionB_monthlyTime":"0 hr 0 min",
                "monthlyCostDifference":"$0.00","monthlyTimeDifference":"0 hr 0 min"
              }
            }
            """.formatted(validDecision()));
    }

    private String validStory() {
        return """
            {
              "decisionId":"decision-1","simulationVersion":4,
              "sharedScenario":{"title":"A shared day","description":"Both options begin with the same plan."},
              "moments":[
                {"key":"morning","options":[{"optionId":"a","text":"The day starts in {{optionA_name}}."},{"optionId":"b","text":"The day starts in {{optionB_name}}."}]},
                {"key":"daytime","options":[{"optionId":"a","text":"The plan continues."},{"optionId":"b","text":"The plan continues."}]},
                {"key":"evening","options":[{"optionId":"a","text":"The evening arrives."},{"optionId":"b","text":"The evening arrives."}]}
              ],
              "monthlyReflections":[{"optionId":"a","text":"The monthly cost is {{optionA_monthlyCost}}."},{"optionId":"b","text":"The monthly cost is {{optionB_monthlyCost}}."}]
            }
            """;
    }

    private String validDecision() {
        return """
            {
              "schemaVersion":1,"id":"decision-1","title":"A choice","description":"Compare a choice","originalInput":"placeholder","currency":"USD",
              "options":[
                {"id":"a","name":"Option A","fixedCosts":[],"activities":[]},
                {"id":"b","name":"Option B","fixedCosts":[],"activities":[]}
              ],
              "tags":[
                {"id":"tag1","name":"First","description":"First change","type":"fixed","targets":[{"optionId":"a","costCentsMonthly":{"value":0,"source":"user_input"},"minutesMonthly":{"value":0,"source":"user_input"}}]},
                {"id":"tag2","name":"Second","description":"Second change","type":"fixed","targets":[{"optionId":"a","costCentsMonthly":{"value":0,"source":"user_input"},"minutesMonthly":{"value":0,"source":"user_input"}}]},
                {"id":"tag3","name":"Third","description":"Third change","type":"fixed","targets":[{"optionId":"a","costCentsMonthly":{"value":0,"source":"user_input"},"minutesMonthly":{"value":0,"source":"user_input"}}]},
                {"id":"tag4","name":"Fourth","description":"Fourth change","type":"fixed","targets":[{"optionId":"a","costCentsMonthly":{"value":0,"source":"user_input"},"minutesMonthly":{"value":0,"source":"user_input"}}]},
                {"id":"tag5","name":"Fifth","description":"Fifth change","type":"fixed","targets":[{"optionId":"a","costCentsMonthly":{"value":0,"source":"user_input"},"minutesMonthly":{"value":0,"source":"user_input"}}]}
              ]
            }
            """;
    }

    private static final class FakeModelClient implements ModelClient {
        private final ArrayDeque<Object> replies = new ArrayDeque<>();
        private int calls;

        void reply(Object... responses) {
            for (Object response : responses) replies.add(response);
        }

        @Override
        public String complete(List<Message> messages) {
            calls++;
            Object response = replies.remove();
            if (response instanceof RuntimeException exception) throw exception;
            return (String) response;
        }

        @Override
        public boolean configured() { return true; }
    }
}
