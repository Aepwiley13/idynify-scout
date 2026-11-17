/**
 * What each plan is, for the screens that describe them. Display only: the
 * server decides what an account may do (netlify/functions/utils/creditGrantFields.js
 * holds the credit amounts a payment actually grants, and must agree with these).
 */
export const PLAN_DETAILS = Object.freeze({
  free: Object.freeze({
    name: 'Free',
    price: '$0',
    summary: 'Contact Hub: your people, your card, stickers and notes.',
  }),
  starter: Object.freeze({
    name: 'Scout Starter',
    price: '$20 / mo',
    credits: 400,
    summary: 'Prospecting, outreach and 400 enrichment credits a month.',
  }),
  pro: Object.freeze({
    name: 'Scout Pro',
    price: '$50 / mo',
    credits: 1250,
    summary: 'Everything in Starter, 1,250 credits a month and mobile numbers.',
  }),
});
