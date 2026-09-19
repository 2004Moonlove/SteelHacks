import type { Decision, NumericField } from "./types";

const assumed = (value: number, note: string): NumericField => ({ value, source: "demo_assumption", confirmed: true, note });

export const demoDecision: Decision = {
  schemaVersion: 1,
  id: "campus-housing-demo",
  title: "Live near campus or farther away?",
  description: "Compare monthly housing costs and one-way campus travel time.",
  originalInput: "Should I rent near campus or farther away?",
  currency: "USD",
  options: [
    {
      id: "near", name: "Near campus",
      fixedCosts: [{ id: "rent", name: "Rent", amountCentsMonthly: assumed(150000, "Illustrative monthly rent for the demo.") }],
      activities: [{
        id: "commute", name: "Walk to campus", eventUnit: "one_way_trip",
        frequencyInput: { label: "Campus days per month", eventsPerUnit: 2 },
        eventsPerMonth: assumed(40, "20 campus days with two one-way trips each."),
        costCentsPerEvent: assumed(0, "Known zero-cost walking trip in this fixture."),
        minutesPerEvent: assumed(10, "Illustrative one-way walking time."),
      }],
    },
    {
      id: "far", name: "Farther away",
      fixedCosts: [{ id: "rent", name: "Rent", amountCentsMonthly: assumed(110000, "Illustrative monthly rent for the demo.") }],
      activities: [{
        id: "commute", name: "Campus shuttle", eventUnit: "one_way_trip",
        frequencyInput: { label: "Campus days per month", eventsPerUnit: 2 },
        eventsPerMonth: assumed(40, "20 campus days with two one-way trips each."),
        costCentsPerEvent: assumed(0, "Known zero-cost transit trip in this fixture."),
        minutesPerEvent: assumed(40, "Illustrative one-way transit time."),
      }],
    },
  ],
  tags: [
    {
      id: "uber", type: "replace_activity", name: "Take an Uber after class", icon: "car-front",
      description: "Replace some farther-away one-way commutes with Uber rides.",
      targets: [{ optionId: "far", activityId: "commute", replacementName: "Uber ride", eventsPerMonth: assumed(6, "Six one-way rides in this example."), costCentsPerEvent: assumed(2500, "Illustrative fare per one-way ride."), minutesPerEvent: assumed(20, "Illustrative duration per one-way ride.") }],
    },
    {
      id: "remote-days", type: "reduce_activity", name: "Spend fewer days on campus", icon: "house",
      description: "Four fewer campus days remove eight one-way commutes in each option.",
      targets: [
        { optionId: "near", activityId: "commute", eventsPerMonth: assumed(8, "Four campus days times two trips.") },
        { optionId: "far", activityId: "commute", eventsPerMonth: assumed(8, "Four campus days times two trips.") },
      ],
    },
    {
      id: "extra-campus", type: "add_activity", name: "Visit campus more often", icon: "calendar-plus",
      description: "Five extra campus days add ten one-way commutes in each option.",
      targets: [
        { optionId: "near", activityId: "commute", eventsPerMonth: assumed(10, "Five campus days times two trips.") },
        { optionId: "far", activityId: "commute", eventsPerMonth: assumed(10, "Five campus days times two trips.") },
      ],
    },
    {
      id: "drive", type: "replace_activity", name: "Drive to campus", icon: "car",
      description: "Replace farther-away one-way commutes with driving.",
      targets: [{ optionId: "far", activityId: "commute", replacementName: "Drive", eventsPerMonth: assumed(15, "Illustrative one-way driving trips."), costCentsPerEvent: assumed(800, "Illustrative fuel and parking per trip."), minutesPerEvent: assumed(25, "Illustrative driving time per trip.") }],
    },
    {
      id: "transit-pass", type: "fixed", name: "Buy a transit pass", icon: "ticket",
      description: "Add a fixed monthly pass cost to the farther-away option.",
      targets: [{ optionId: "far", costCentsMonthly: assumed(9750, "Illustrative monthly pass price."), minutesMonthly: assumed(0, "A pass does not itself take time.") }],
    },
    {
      id: "parking", type: "fixed", name: "Pay for parking", icon: "square-parking",
      description: "Add a fixed monthly parking fee to the farther-away option.",
      targets: [{ optionId: "far", costCentsMonthly: assumed(6000, "Illustrative monthly parking price."), minutesMonthly: assumed(0, "Parking fee has no direct time cost in this example.") }],
    },
  ],
};
