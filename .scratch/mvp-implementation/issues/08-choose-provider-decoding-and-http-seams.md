# Choose provider decoding and HTTP seams

Type: grilling
Status: open
Blocked by: 01, 02, 05

## Question

Which runtime-validation, HTTP, rate-limit, retry, time, and cancellation seams
should Providers expose internally, which third-party dependencies earn their
cost, and which behavior belongs behind one deep module rather than a chain of
shallow wrappers?

