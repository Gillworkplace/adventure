export class RecognitionStatus {
  reset() { this.issue = this.pending = null; this.since = 0; }
  update(issue, at) {
    if (!issue) { this.reset(); return null; }
    if (!this.issue) this.issue = issue;
    if (issue === this.issue) this.pending = null;
    else if (this.pending !== issue) { this.pending = issue; this.since = at; }
    else if (at - this.since >= 1500) { this.issue = issue; this.pending = null; }
    return this.issue;
  }
}
