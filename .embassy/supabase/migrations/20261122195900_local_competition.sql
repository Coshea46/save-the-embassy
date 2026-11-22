-- Existing attempts use their original receipts, deadline and submission route.
alter table embassy.runs add column protocol smallint not null default 1
  check (protocol in (1, 2));
