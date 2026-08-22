# ParcelPilot Assignment — Explained

## The big picture: what is ParcelPilot?

Think of a real service like **Shiprocket** or **Delhivery** in India, or **ShipStation** internationally. These are platforms that businesses use to book courier pickups and manage deliveries — the platform itself doesn't own trucks or drivers. Instead, it's a middle layer that connects a business to multiple courier companies (like BlueDart, DTDC, FedEx) so the business doesn't have to deal with each courier separately.

**ParcelPilot is a fictional version of exactly this.** It's a B2B (business-to-business) logistics platform. Its actual customers aren't individual shoppers — they're *other businesses* that ship a lot of parcels and use ParcelPilot to book and track those shipments across various courier ("carrier") partners.

In our data pack, there are 4 such business customers:
- **Northstar Logistics** — a big strategic customer, on the priciest "Enterprise" plan, with a custom contract
- **LumenWorks** — a mid-size customer on the "Growth" plan, also with a custom contract
- **Beacon Retail** — a smaller customer on the basic "Standard" plan, no custom contract
- **Axis Labs** — an "Enterprise" plan customer, but no custom contract (just standard terms)

Each of these companies books shipments through ParcelPilot, and sometimes something goes wrong — a pickup is late, they want to cancel an order, their bulk upload tool breaks, etc. When that happens, they contact **ParcelPilot's own support team** (real human agents like Priya, Rohit, Maya, Arjun in the data) to get help.

**The assignment, in one sentence:** build an AI chatbot that can do part of that support team's job — answer these companies' questions correctly (or escalate to a human when it shouldn't guess) — using only the documents and data ParcelPilot has given us.

---

## The documents: ParcelPilot's own internal rulebook

Keep the Shiprocket/Delhivery analogy going. Any real logistics company has a stack of internal documents that its support team is trained on — official policy PDFs, SOPs (Standard Operating Procedures), and negotiated contracts with big clients. We have 6 of these:

**1. `Support Policy v3` — CURRENT (effective 1 May 2026)**
This is the master rulebook for how fast the support team must respond to a problem, based on how serious it is. Every support ticket gets a severity:
- **P1 (Critical)** — e.g., a customer literally cannot create any shipments at all, or there's a security breach. Drop everything.
- **P2 (High)** — a major feature is broken but there's a workaround.
- **P3 (Normal)** — minor stuff, how-to questions.

And it says how fast ParcelPilot must respond depending on the customer's *plan tier* (Enterprise customers get faster responses than Standard customers — like how a premium credit card gets you a faster helpline).

**2. `Support Policy v2` — DEPRECATED**
This is the *old* version of that same rulebook, from before 1 May 2026. It has different (slower) response-time numbers. It's explicitly marked "do not use for current requests" — but it's still sitting in the folder. Real companies keep old versions around for record-keeping, and a naive search tool might accidentally pull numbers from this instead of v3.

**3. `Cancellation & Service Credit SOP v4` — CURRENT**
This is the specific rulebook for two common situations: "Can this shipment be cancelled, and does it cost anything?" and "My pickup was late — do I get money back (a service credit)?" It lays out defaults like "if you cancel a booked shipment within 30 minutes, it's free; after that, ₹250" and "if pickup is more than 2 hours late and it's the courier's fault, you get a credit."

**4. `Product Operations Guide and Known Issues` — CURRENT**
This is like an engineering/product status page — what features exist on which plan, what the technical terms mean (e.g., what "BOOKED" vs "PICKED_UP" actually means in the system), and a running list of **known bugs currently being investigated**. This matters a lot: if a customer's problem matches a listed known bug, support shouldn't treat it as a mysterious new emergency — they should recognize it and give the known workaround.

**5 & 6. Two individual customer contracts — Northstar's and LumenWorks'.**
This is the real-world equivalent of a negotiated enterprise deal. Big customers often negotiate *better terms than the standard policy* — e.g., "as a favor to us for being a big customer, you'll never charge us a cancellation fee" or "you'll respond to our critical tickets in 15 minutes instead of the usual 30." These contracts **override** the general policies for that one specific customer only. Beacon Retail and Axis Labs don't have one of these, so standard policy applies to them by default.

**The key idea tying all 6 together:** these documents don't always agree with each other, and some are more "senior" than others. A signed contract beats the general policy. The current policy beats the deprecated one. This hierarchy is something the chatbot has to actually understand and apply — not just search and quote whatever it finds first.

---

## The structured data: ParcelPilot's live operational database

If the documents are the *rulebook*, this Excel file is the *system of record* — the actual live database a real support agent would query when helping a customer. It's like the internal dashboard a Shiprocket support rep pulls up when you call in. It has 4 sheets:

**README sheet** — just metadata. The important line: it tells us the "snapshot time" is **16 August 2026, 11:00 AM (India time)**. This matters because several questions are time-sensitive ("has pickup been late for X hours?", "has the SLA already been breached?") — the AI needs to treat this as "right now" when doing any time math, not today's real date.

**`accounts` sheet** — the list of the 4 business customers I mentioned earlier (Northstar, LumenWorks, Beacon Retail, Axis Labs), with their plan tier, which contract file applies to them (if any), and who their dedicated ParcelPilot account manager (CSM) is.

**`orders` sheet** — individual shipments booked through ParcelPilot. Each row is one parcel: which account it belongs to, which courier ("carrier") is handling it, its current status (`BOOKED` → `PICKED_UP` → `DELIVERED`), when it was booked, the scheduled pickup time window, whether the courier or the customer was at fault for any problem, and whether the customer has asked to cancel it. This is exactly the kind of record a support agent looks up to answer "what's going on with my shipment."

**`tickets` sheet** — actual support conversations customers have had. Each row is a support ticket: who raised it, what they said, whether it's still open or already closed. Two of these tickets are *old and closed*, and they include a field called `historical_resolution` — literally what a past support agent told the customer. The rest are the *current, open* tickets — these are essentially the "live queue" the AI chatbot might need to help resolve today.

**Why this data matters together with the documents:** a real support answer almost never comes from *just* a policy PDF or *just* a database lookup — it needs both. E.g., "Can this shipment be cancelled without a fee?" requires: look up the *order* (its status, when it was booked) in the spreadsheet, look up which *account* it belongs to, check if that account has a *contract* that changes the rules, and if not, fall back to the *general SOP*. That's the multi-step reasoning this assignment is testing.

---

## The issues: deliberate traps baked into the data

These aren't accidents — this whole pack is built like an obstacle course to see if an AI system handles messy, contradictory real-world information carefully, or just confidently makes stuff up. Here they are, one category at a time, with the actual examples from the data.

**A) The same rule exists twice, with different numbers (version conflict)**
Policy v2 (deprecated) and Policy v3 (current) both define response-time targets, but the numbers are different — v3 is *faster* across the board. If the AI's search just finds "a document about response times" without checking which one is current, it could confidently quote the wrong (slower) numbers. This is the simplest trap: **read the status field, not just the content.**

**B) Past advice was just plain wrong (this is the "don't trust history" trap)**
Two old, closed tickets contain a field showing what a past support agent actually told the customer:
- **TKT-450**: Northstar asked to cancel a shipment 90 minutes after booking. The old agent said "₹250 fee applies." But Northstar's *contract* (which is the highest-authority document) says Northstar never pays a cancellation fee, regardless of timing. **The historical answer was wrong.**
- **TKT-451**: LumenWorks was told "Growth plan only supports 3,000-row uploads." But the actual product limit is 5,000 rows — 3,000 is just the threshold where a *current known bug* starts causing intermittent failures, not a hard plan limit. **The historical answer conflated a bug with a policy.**

If the AI treats "what we told the customer last time" as reliable precedent, it repeats these mistakes. The instructions are explicit that historical resolutions are "context only" and may be wrong.

**C) One customer's deal overrides the general rule — and it's easy to get inconsistent**
Northstar and LumenWorks each negotiated custom contract terms that beat the standard policy. E.g.: under the *default* SOP, a late pickup only earns a credit if it's more than 2 hours late, capped around ₹500. But LumenWorks' contract replaces this entirely: their threshold is 4 hours late, and the credit is a flat ₹300 — different trigger, different amount. So the exact same question ("pickup was 3 hours late, courier's fault — do I get a credit?") has **a different correct answer depending on which company is asking** — yes by default policy, no under LumenWorks' contract. The system has to know *whose* question it's answering before it can answer it.

**D) Distinguishing "this is a known, already-being-fixed bug" from "sound the alarm"**
The Product Ops Guide lists currently known issues, e.g. **KI-211**: a specific courier's (SwiftShip) pickup confirmations can arrive up to 20 minutes late in the system, even after the parcel is actually picked up. Now look at **ticket TKT-504**: a Northstar customer says "driver picked up my parcel ~10 minutes ago but the system still shows BOOKED." That's *exactly* what KI-211 describes — it's not a new emergency, it's a known, already-documented lag. Treating it as a fresh critical bug (or telling the customer something is broken) would be an overreaction; the guide even says to verify carrier status or just wait out the known delay window before concluding pickup failed.

**E) The clock may have already run out**
**Ticket TKT-501**: Northstar reports total shipment-creation failure — a textbook P1 (critical) issue. Northstar's contract sets a 15-minute response promise for P1 issues. The ticket was created at 10:30, and the dataset's "current time" is 11:00 — **30 minutes have already passed**, blowing past the 15-minute promise. A good system should notice this and say so plainly ("this SLA has already been breached — escalate now") rather than just calmly stating the policy number as if there's still time.

**F) Requests nobody wrote a rule for**
**Ticket TKT-503** is just "please change our billing contact email." None of the 6 documents say anything about how to do that. There's no policy to cite. The honest answer here isn't to guess a plausible-sounding process — it's to recognize this is outside what any of the supplied information covers, and hand it to a human.

**One more, smaller one:** the Product Ops Guide also lists a *resolved* issue (KI-176, address validation) with a note explicitly warning not to use it to explain new problems unless the evidence really matches — i.e., don't pattern-match a new complaint onto an old closed bug just because it's the first thing that comes up in search.

---

## What you actually need to build

Now that you've seen the rulebook and the traps, here's what the assignment wants — mapped back to what we just walked through.

**1. A chatbot that answers questions using only this data pack.**
Someone (a customer or a ParcelPilot staff member — your choice, more on that later) types a question in plain English, like "Can Northstar cancel ORD-1001 without a fee?" The system has to figure out the answer using the documents and spreadsheet we just covered — and specifically has to get the *authority hierarchy* right (contract beats policy beats deprecated doc, current known-issue beats guesswork, etc.) rather than just grabbing the first plausible-looking match.

**2. When it doesn't know, it says so — it doesn't bluff.**
This is directly the TKT-503 "billing contact change" situation, or a case where two sources genuinely conflict and there's no way to tell which applies. The correct behavior is: hand it off to a human ("escalate"), not confidently invent an answer. A wrong-but-confident answer is treated as worse than an honest "I'm not sure, here's what I'd flag for a person."

**3. People can only see what they're allowed to see (access control).**
Think of this like your online banking app — you can see *your* account statement, never your neighbor's, no matter what you type into the search box. If you build the customer-facing version: a Northstar employee chatting with the bot must never be able to pull up LumenWorks' orders or tickets, even by asking cleverly. If you build the internal staff version instead: a ParcelPilot support agent could reasonably see multiple accounts, but maybe not everything (e.g., maybe only tickets, not billing/financial detail) depending on their role. Importantly, this can't just be "the AI has been told not to" — it has to be enforced in the actual code/data layer, the same way your bank's server refuses the request regardless of what you say to the teller.

**4. The bot has to use at least 3 distinct "tools," not just one big brain.**
This means the system is explicitly built as an *agent* that can choose between different capabilities depending on the question, rather than one blob of text generation. The three required categories:
   - **Look something up in the documents** (e.g., "what does the SOP say about cancellation fees") — this is document search over the 6 PDFs.
   - **Look something up or calculate something in the live data** (e.g., "how many hours late was ORD-2002's pickup, and what's 10% of its shipment fee") — this is querying/calculating over the accounts/orders/tickets spreadsheet.
   - **Actually change something** (e.g., create a support escalation, update a ticket, create a follow-up task for a human) — this is a real "write" action, though it's fine if it's a fake/mocked version rather than a real production system.

**5. Before it *does* anything (not just says something), it has to ask "are you sure?"**
If the bot decides an escalation is warranted, it should prepare what it *would* do and show it to the user first — "I'm about to create a P1 escalation for ticket TKT-501, confirm?" — and only actually execute after the person says yes. It should never silently take an action on its own.

**6. It has to handle questions that need several steps chained together.**
This is the multi-step reasoning we saw in the Northstar cancellation example: look up the order → find which account it belongs to → check if that account has a special contract → check the general policy as a fallback → do any needed math → decide if this needs a human. One question, several tools/documents used in sequence.

**7. A simple chat interface, ideally showing which tool is running.**
Not polish-focused — just something a person can actually type into and watch work, where you can visibly see "now searching documents..." vs "now looking up order data..." vs "now preparing an escalation..." so it doesn't feel like a black box.

**Beyond the minimum, there are two optional "bonus" problems** ParcelPilot describes wanting help with, and you're invited to tackle one (or partially both):
- **Proactive issue detection** — instead of only answering when asked, build something that scans across all the tickets/orders and surfaces things a human should look at — e.g., "3 different customers are hitting the bulk-upload known issue this week" or "this P1 ticket is about to breach its SLA." Think of it like a dashboard for the ops team, not a chat.
- **Trust and reliability** — this is really "formalize everything we just discussed" — make the system's handling of conflicting sources, outdated docs, and uncertainty deliberate and visible, rather than hoping the model quietly does the right thing.

**Finally, what you submit isn't just code** — it's the working app (ideally hosted somewhere live), a ~5 minute demo video walking through the architecture and a live demo, a short written note explaining your technical decisions (especially how you handled the source-conflict problem), a short product note (what you'd build next, what you deliberately left out, and how you'd measure if it's actually useful), and a note on which AI coding tools you used.
