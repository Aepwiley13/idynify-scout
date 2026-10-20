/**
 * Output rules for the Barry endpoints that write a message the user sends:
 * sequence-step, campaign-message and engagement-message (#699).
 *
 * The 330-call comparison (Actions run 39478139161) found these writers
 * leaving `[Your Name]` in 26 of 40 drafts on Sonnet 5.5 (12 of 40 on 4.5),
 * signing one set of drafts "Barry", and inventing meeting times, attachments,
 * earlier conversations and customer results. Nothing fills in a placeholder
 * before a draft is sent, so these rules go at the end of each prompt, where
 * they override anything above them. generate-followup.js carries the same
 * rules in its own words; with them, the comparison found 0 placeholders in
 * 10 follow-up drafts.
 *
 * None of these endpoints is given the sender's name, so every email ends
 * with "Best," and no name.
 */
export const OUTBOUND_COPY_RULES = `OUTPUT RULES (these override anything above that conflicts with them):
- Write only the message itself: no notes, explanations, disclaimers or alternative versions inside it.
- No placeholders or bracketed text to fill in, such as [Your Name], [Name], [Company], [calendar link] or [date]. If you don't know something, write the sentence without it.
- The sender's name is not given here, so end emails with "Best," and no name. Never sign as Barry, and never mention Barry in the message.
- Use only facts given above. Do not invent meetings, calls, prior conversations, attachments, links, dates, times, customer outcomes, metrics, proof points or product capabilities. To suggest a meeting, ask what time suits them instead of proposing specific days or times.
- A target such as cutting write-offs in half is a goal, not a result: present it as what you aim for, never as something customers have already achieved, unless the context above says it was achieved.
- Do not say or imply that you have spoken, met or been in touch before unless the context above shows it.`;
