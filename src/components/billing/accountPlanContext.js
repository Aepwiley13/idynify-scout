/**
 * The signed-in account's plan, for screens inside the shell that offer an upgrade or a paid
 * action (utils/accountPlan.js planOf: 'free' | 'starter' | 'pro' | 'unknown').
 *
 * Provided once by the shell's account gate (freePlanRouting.jsx ShellAccountGate), from the
 * account state the gate has already read, so no screen reads billing data itself. Outside the
 * shell it is 'unknown', and an unknown plan is never offered a purchase.
 */
import { createContext, useContext } from 'react';
import { PLAN } from '../../utils/accountPlan';

export const AccountPlanContext = createContext(PLAN.UNKNOWN);

export const useAccountPlan = () => useContext(AccountPlanContext);
