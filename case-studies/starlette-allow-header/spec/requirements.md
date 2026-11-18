# Requirements: a 405 lists the allowed methods in one fixed order

## Introduction
`Route.handle` in `starlette/routing.py` answers a request whose method the route does not accept with 405 and an `Allow`
header built from `self.methods`, which is a set. The order of a set of strings depends on the process's hash seed, so the
same request gets a different order in different worker processes (encode/starlette#3793). On main 271c277 a route that
accepts GET, POST, PUT and DELETE answers PATCH with `HEAD, GET, PUT, DELETE, POST` under PYTHONHASHSEED=1 and
`GET, PUT, HEAD, DELETE, POST` under PYTHONHASHSEED=2. Caches, clients and tests that compare the header see different
values for the same request.

## Requirement 1: One order for the Allow header
**User story:** As someone who runs Starlette in several worker processes, I want a 405's `Allow` header to be the same in
every process, so that caches, clients and tests see one value for one route.
### Acceptance criteria
1. WHEN a `Route` that accepts GET, POST, PUT and DELETE receives a PATCH request THE SYSTEM SHALL respond 405 with the
   `Allow` header exactly `DELETE, GET, HEAD, POST, PUT`: the route's methods, including the HEAD that Starlette adds when
   GET is accepted, in alphabetical order.
2. WHEN that same request is answered in separate Python processes started with PYTHONHASHSEED set to 1, 2, 3 and 4 THE
   SYSTEM SHALL send the same `Allow` value from every process.
3. WHEN it responds 405 THE SYSTEM SHALL keep the status code, the response body and every other header it sends today.
4. WHEN the route accepts the request's method THE SYSTEM SHALL answer as it does today: a GET to that route returns 200
   with the endpoint's body.
