package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigInteger;

/** Reconstructs paid subscription coverage for a shared, user-editable month window. */
final class SubscriptionReconciler {
    private static final BigInteger MAX = BigInteger.valueOf(9_007_199_254_740_991L);
    private final ContractValidator contract;

    SubscriptionReconciler(ContractValidator contract) { this.contract = contract; }

    void reconcile(JsonNode snapshot) {
        JsonNode decision = snapshot.path("decision");
        int months = decision.has("comparisonMonths")
                ? (int) contract.monthCount(decision.path("comparisonMonths"), "snapshot.decision.comparisonMonths") : 12;
        JsonNode calculation = contract.object(snapshot.path("calculation"), "snapshot.calculation");
        contract.onlyFields(calculation, "snapshot.calculation", "status", "comparisonMonths", "options", "timeline", "comparison");
        contract.oneOf(calculation.path("status"), "snapshot.calculation.status", "subscription");
        if (contract.monthCount(calculation.path("comparisonMonths"), "snapshot.calculation.comparisonMonths") != months) {
            ContractValidator.fail("snapshot.calculation.comparisonMonths", "The comparison window does not match the decision.");
        }
        JsonNode results = contract.array(calculation.path("options"), "snapshot.calculation.options", 2, 2);
        long[] payments = new long[2], totals = new long[2];
        int[] periods = new int[2];
        for (int i = 0; i < 2; i++) {
            String path = "snapshot.calculation.options[" + i + "]";
            JsonNode option = decision.path("options").get(i);
            JsonNode costs = option.path("subscriptionCosts");
            JsonNode payment = costs.path("paymentCents");
            if ("unknown".equals(payment.path("source").asText())
                    || ("demo_assumption".equals(payment.path("source").asText()) && !payment.path("confirmed").asBoolean())) {
                ContractValidator.fail("snapshot.decision.options[" + i + "].subscriptionCosts.paymentCents",
                        "Subscription stories require complete, confirmed payment amounts.");
            }
            payments[i] = contract.integer(payment.path("value"), path + ".paymentCents");
            periods[i] = (int) contract.monthCount(costs.path("periodMonths"), path + ".periodMonths");
            long count = (months + periods[i] - 1L) / periods[i];
            totals[i] = cost(count, payments[i], path + ".totalCostCents");
            JsonNode actual = contract.object(results.get(i), path);
            contract.onlyFields(actual, path, "optionId", "totalCostCents", "paymentCount", "coverageMonths");
            if (!option.path("id").asText().equals(contract.id(actual.path("optionId"), path + ".optionId"))) {
                ContractValidator.fail(path + ".optionId", "Result option does not match decision.");
            }
            if (contract.integer(actual.path("totalCostCents"), path + ".totalCostCents") != totals[i]
                    || contract.integer(actual.path("paymentCount"), path + ".paymentCount") != count
                    || contract.integer(actual.path("coverageMonths"), path + ".coverageMonths") != count * periods[i]) {
                ContractValidator.fail(path, "Payment totals or coverage do not match the subscription inputs.");
            }
        }
        JsonNode timeline = contract.array(calculation.path("timeline"), "snapshot.calculation.timeline", months + 1, months + 1);
        for (int month = 0; month <= months; month++) {
            String path = "snapshot.calculation.timeline[" + month + "]";
            JsonNode point = contract.object(timeline.get(month), path);
            contract.onlyFields(point, path, "month", "optionACostCents", "optionBCostCents");
            if (contract.integer(point.path("month"), path + ".month") != month) ContractValidator.fail(path + ".month", "Timeline months must be consecutive from zero.");
            for (int i = 0; i < 2; i++) {
                String key = i == 0 ? "optionACostCents" : "optionBCostCents";
                long count = month == 0 ? 0 : (month + periods[i] - 1L) / periods[i];
                if (contract.integer(point.path(key), path + "." + key) != cost(count, payments[i], path + "." + key)) {
                    ContractValidator.fail(path + "." + key, "Timeline costs do not match actual period payments.");
                }
            }
        }
        JsonNode comparison = contract.object(calculation.path("comparison"), "snapshot.calculation.comparison");
        contract.onlyFields(comparison, "snapshot.calculation.comparison", "costDeltaCents");
        JsonNode delta = comparison.path("costDeltaCents");
        if (!delta.isIntegralNumber() || !delta.canConvertToLong() || delta.longValue() != totals[1] - totals[0]) {
            ContractValidator.fail("snapshot.calculation.comparison.costDeltaCents", "The cost difference does not match period totals.");
        }
    }

    private long cost(long count, long payment, String path) {
        BigInteger result = BigInteger.valueOf(count).multiply(BigInteger.valueOf(payment));
        if (result.compareTo(MAX) > 0) ContractValidator.fail(path, "Subscription totals exceed the safe integer range.");
        return result.longValue();
    }
}
