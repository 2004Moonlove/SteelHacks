package app.dayfork;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigInteger;

/** Independently validates the cost-per-use comparison before its facts reach the model. */
final class BreakEvenReconciler {
    private final ContractValidator contract;

    BreakEvenReconciler(ContractValidator contract) {
        this.contract = contract;
    }

    void reconcile(JsonNode snapshot) {
        JsonNode decision = snapshot.path("decision");
        JsonNode calculation = contract.object(snapshot.path("calculation"), "snapshot.calculation");
        contract.onlyFields(calculation, "snapshot.calculation", "status", "options", "crossover");
        contract.oneOf(calculation.path("status"), "snapshot.calculation.status", "break_even");
        JsonNode results = contract.array(calculation.path("options"), "snapshot.calculation.options", 2, 2);
        long[] upfront = new long[2];
        long[] perUse = new long[2];
        for (int i = 0; i < 2; i++) {
            String path = "snapshot.calculation.options[" + i + "]";
            JsonNode option = decision.path("options").get(i);
            JsonNode costs = option.path("usageCosts");
            upfront[i] = confirmed(costs.path("upfrontCents"), "snapshot.decision.options[" + i + "].usageCosts.upfrontCents");
            perUse[i] = confirmed(costs.path("perUseCents"), "snapshot.decision.options[" + i + "].usageCosts.perUseCents");
            JsonNode actual = contract.object(results.get(i), path);
            contract.onlyFields(actual, path, "optionId", "upfrontCents", "perUseCents");
            if (!option.path("id").asText().equals(contract.id(actual.path("optionId"), path + ".optionId"))) {
                ContractValidator.fail(path + ".optionId", "Result option does not match decision.");
            }
            if (contract.integer(actual.path("upfrontCents"), path + ".upfrontCents") != upfront[i]
                    || contract.integer(actual.path("perUseCents"), path + ".perUseCents") != perUse[i]) {
                ContractValidator.fail(path, "Break-even costs do not match the confirmed decision values.");
            }
        }
        String path = "snapshot.calculation.crossover";
        JsonNode crossing = contract.object(calculation.path("crossover"), path);
        long upfrontDelta = upfront[1] - upfront[0];
        long rateDelta = perUse[1] - perUse[0];
        String kind = upfrontDelta == 0 && rateDelta == 0 ? "equal"
                : upfrontDelta != 0 && rateDelta != 0 && Long.signum(upfrontDelta) != Long.signum(rateDelta)
                    ? "crossing" : "no_crossing";
        contract.oneOf(crossing.path("kind"), path + ".kind", kind);
        if (kind.equals("crossing")) {
            contract.onlyFields(crossing, path, "kind", "numerator", "denominator", "firstWholeUse", "recoveryOptionId");
            long numerator = Math.abs(upfrontDelta);
            long denominator = Math.abs(rateDelta);
            long first = BigInteger.valueOf(numerator).add(BigInteger.valueOf(denominator - 1))
                    .divide(BigInteger.valueOf(denominator)).longValueExact();
            String recoveryId = decision.path("options").get(upfrontDelta > 0 ? 1 : 0).path("id").asText();
            if (contract.integer(crossing.path("numerator"), path + ".numerator") != numerator
                    || contract.integer(crossing.path("denominator"), path + ".denominator") != denominator
                    || contract.integer(crossing.path("firstWholeUse"), path + ".firstWholeUse") != first
                    || !recoveryId.equals(contract.id(crossing.path("recoveryOptionId"), path + ".recoveryOptionId"))) {
                ContractValidator.fail(path, "The crossover does not match the confirmed upfront and per-use costs.");
            }
        } else contract.onlyFields(crossing, path, "kind");
    }

    private long confirmed(JsonNode field, String path) {
        if ("unknown".equals(field.path("source").asText())
                || ("demo_assumption".equals(field.path("source").asText()) && !field.path("confirmed").asBoolean())) {
            ContractValidator.fail(path, "Break-even stories require complete, confirmed cost inputs.");
        }
        return contract.integer(field.path("value"), path + ".value");
    }
}
