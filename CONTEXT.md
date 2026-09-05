# Book Title Lookup

Book Title Lookup identifies a written work from a title in one language and
finds evidence of titles under which that same work was published in other
languages.

## Bibliographic Identity

**Written Work**:
The intellectual content created by one or more authors, independent of any
particular publication.
_Avoid_: Book record, title record

**Edition**:
A publication of a Written Work with particular bibliographic characteristics,
such as language, publisher, publication date, and identifiers.
_Avoid_: Copy, Work

**Work Candidate**:
A Written Work that may match a user's query but has not yet been confirmed.
_Avoid_: Result, match

**Resolved Work**:
The Written Work confirmed as the subject of a lookup, either by the user or by
an unambiguous strong identifier.
_Avoid_: Selected book, canonical book

**External Reference**:
A namespaced identifier assigned to a Work or Edition by an outside catalog.
_Avoid_: Global ID, internal ID

**Source Record**:
An unmodified bibliographic record obtained from an external data source.
_Avoid_: Work, Edition

## Titles and Evidence

**Attested Title**:
A title supported by bibliographic evidence that it names a Work or a published
Edition.
_Avoid_: Translation, translated title

**Title Attestation**:
The evidence connecting an Attested Title to a Work or Edition and to its
source.
_Avoid_: Result, citation

**Title Group**:
Attested Titles with the same conservatively normalized text and language,
presented together without discarding their separate attestations.
_Avoid_: Translation group

**Original Title**:
The title under which a Written Work was originally created or first published,
when supported by explicit evidence.
_Avoid_: Canonical title

**Search Alias**:
A name used to discover or disambiguate a Work but not, by itself, evidence of a
published title.
_Avoid_: Attested Title, alternate title

**Suggested Translation**:
A machine-generated rendering of a title without evidence that a corresponding
Edition was published under that name.
_Avoid_: Attested Title

**Evidence Level**:
An explainable classification—Verified, Probable, or Ambiguous—of how strongly
the available attestations connect a title or candidate to the Resolved Work.
_Avoid_: Confidence score, probability

## Language

**Content Language**:
A language in which the text of an Edition is expressed.
_Avoid_: Title Language

**Title Language**:
The explicitly recorded language of an Attested Title, which may remain unknown
even when an Edition has one or more known Content Languages.
_Avoid_: Detected language

