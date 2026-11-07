<template>
  <div>
    <template v-if="assessmentSync && loaded">
      <p class="audit-meta mb-2">
        {{ $t('message.assessment_ownership') }}: {{ ownershipLabel }}
      </p>
      <p v-if="decisionOrigin === 'POLICY'" class="small text-muted">
        {{ $t('message.assessment_policy_explanation') }}
      </p>
      <div v-if="conflict" class="alert alert-warning" role="alert">
        <p>{{ $t('message.assessment_conflict') }}</p>
        <b-button
          :disabled="auditDrawer.saving"
          variant="outline-secondary"
          @click="reloadForReview"
        >
          {{ $t('message.assessment_reload_review') }}
        </b-button>
        <section
          v-if="review"
          class="mt-3"
          :aria-label="$t('message.assessment_server_decision')"
        >
          <h6>{{ $t('message.assessment_server_decision') }}</h6>
          <dl>
            <dt>{{ $t('message.assessment_ownership') }}</dt>
            <dd>{{ ownershipLabel }}</dd>
            <template v-for="(value, field) in review" :key="field">
              <dt>{{ fieldLabel(field) }}</dt>
              <dd class="audit-text">{{ fieldValue(field, value) }}</dd>
            </template>
          </dl>
          <b-button
            :disabled="auditDrawer.saving"
            variant="primary"
            @click="acceptReview"
          >
            {{ $t('message.assessment_keep_draft') }}
          </b-button>
        </section>
      </div>
      <div v-if="refreshFailed" class="alert alert-warning" role="alert">
        <p>{{ $t('message.assessment_refresh_failed') }}</p>
        <b-button
          :disabled="auditDrawer.saving"
          variant="outline-secondary"
          @click="reloadAfterMutation"
        >
          {{ $t('message.assessment_reload') }}
        </b-button>
      </div>
      <p v-if="actionFailed" class="text-danger" role="alert">
        {{ $t('condition.unsuccessful_action') }}
      </p>
    </template>
    <b-tabs v-model:index="auditDrawer.tabIndex" content-class="pt-3" no-fade>
      <b-tab :title="$t('message.analysis')">
        <slot />
        <hr />
        <div
          v-if="assessmentSync && canAnalyze && loaded"
          class="d-flex flex-wrap gap-2 mb-3"
        >
          <b-button
            v-if="decisionOrigin !== 'LOCAL'"
            variant="outline-secondary"
            :disabled="writesBlocked || auditDrawer.saving"
            @click="changeOwnership('TAKE_LOCAL')"
          >
            {{ $t('message.assessment_take_local') }}
          </b-button>
          <b-button
            v-if="decisionOrigin === 'LOCAL'"
            variant="outline-secondary"
            :disabled="writesBlocked || auditDrawer.saving"
            @click="release"
          >
            {{ $t('message.assessment_release_local') }}
          </b-button>
        </div>
        <audit-form
          v-if="canAnalyze"
          ref="analysisForm"
          v-slot="{ form }"
          :loaded="loaded"
          :failed="failed"
          :blocked="writesBlocked"
          :preserve-draft="assessmentSync"
          :keep-draft="conflict"
          :submit="save"
          :states="states"
          :state-description="stateDescription"
          @state-change="
            (form, state) => $emit('state-change', form, state, loaded)
          "
        >
          <slot name="fields" :form="form" />
        </audit-form>
      </b-tab>
      <b-tab :title="$t('message.history')">
        <audit-history
          :comments="comments"
          :blocked="writesBlocked"
          :submit="canAnalyze && loaded ? addComment : null"
        />
      </b-tab>
      <b-tab
        v-if="assessmentSync && sources.length"
        :title="$t('message.assessment_sources')"
      >
        <assessment-sources :sources="sources" />
      </b-tab>
    </b-tabs>
  </div>
</template>

<script>
import common from '@/shared/common';
import AuditForm from '@/views/components/AuditForm.vue';
import AuditHistory from '@/views/components/AuditHistory.vue';
import AssessmentSources from '@/views/components/AssessmentSources.vue';

// fields maps each analysis field of the API to its value when unset; ids identify the analysis.
// noAnalysisStatus is the error status an API answers with before the first analysis exists.
export default {
  components: { AuditForm, AuditHistory, AssessmentSources },
  inject: ['auditDrawer'],
  props: {
    url: String,
    ids: Object,
    fields: Object,
    canAnalyze: Boolean,
    states: Array,
    stateDescription: String,
    noAnalysisStatus: Number,
    assessmentSync: Boolean,
  },
  emits: ['loaded', 'state-change'],
  data: () => ({
    loaded: null,
    failed: false,
    comments: [],
    sources: [],
    decisionOrigin: null,
    decisionVersion: null,
    conflict: false,
    review: null,
    refreshFailed: false,
    actionFailed: false,
  }),
  computed: {
    writesBlocked() {
      return this.assessmentSync && (this.conflict || this.refreshFailed);
    },
    ownershipLabel() {
      const labels = {
        LOCAL: this.$t('message.assessment_origin_local'),
        POLICY: this.$t('message.assessment_origin_policy'),
        INHERITED: this.$t('message.assessment_origin_inherited'),
        NEUTRAL: this.$t('message.assessment_origin_neutral'),
      };
      return (
        labels[this.decisionOrigin] ??
        this.$t('message.assessment_origin_unknown')
      );
    },
  },
  methods: {
    update(analysis) {
      this.loaded = Object.fromEntries(
        Object.entries(this.fields).map(([field, unset]) => [
          field,
          analysis[field] ?? unset,
        ]),
      );
      this.comments = analysis.analysisComments || [];
      this.sources = analysis.sourceAssessments || [];
      this.decisionOrigin = analysis.decisionOrigin ?? null;
      this.decisionVersion = analysis.decisionVersion ?? null;
      this.failed = false;
      this.$emit('loaded', analysis);
    },
    async load() {
      const response = await this.axios.get(
        common.setQueryParams(this.url, this.ids),
        {
          validateStatus: (status) =>
            status === 200 || status === this.noAnalysisStatus,
        },
      );
      this.update((response.status === 200 && response.data) || {});
    },
    put(analysis, comment = null) {
      return this.axios.put(this.url, { ...this.ids, ...analysis, comment });
    },
    async mutate(decisionAction, fields = {}, comment) {
      if (this.writesBlocked) throw new Error('Assessment requires review');
      const body = { ...this.ids, decisionAction, ...fields };
      if (comment !== undefined) body.comment = comment;
      if (this.decisionVersion != null)
        body.expectedDecisionVersion = this.decisionVersion;
      try {
        await this.axios.put(this.url, body);
      } catch (error) {
        if (error.response?.status === 409) {
          this.conflict = true;
          this.review = null;
        }
        throw error;
      }
      // A failed GET must not turn an accepted mutation into a retryable write.
      this.refreshFailed = true;
      try {
        await this.load();
        this.refreshFailed = false;
      } catch {
        // Keep the draft and block further writes until a GET succeeds.
      }
      this.auditDrawer.notifySaved();
    },
    async save(form) {
      if (!this.assessmentSync) {
        this.update((await this.put(form)).data);
        this.auditDrawer.notifySaved();
        return;
      }
      await this.mutate(
        'TAKE_LOCAL',
        Object.fromEntries(
          Object.keys(this.fields).map((field) => [field, form[field]]),
        ),
      );
    },
    async addComment(comment) {
      if (this.assessmentSync) return this.mutate('COMMENT_ONLY', {}, comment);
      // Policy violation analysis still requires resending its stored decision.
      this.comments =
        (await this.put(this.loaded, comment)).data.analysisComments || [];
    },
    async changeOwnership(action) {
      if (this.writesBlocked || this.auditDrawer.saving) return;
      this.auditDrawer.setSaving(true);
      this.actionFailed = false;
      try {
        // Deliberately do not send the editable draft when taking ownership.
        await this.mutate(action);
        this.$toastr.s(this.$t('message.updated'));
      } catch {
        this.actionFailed = true;
        this.$toastr.w(this.$t('condition.unsuccessful_action'));
      } finally {
        this.auditDrawer.setSaving(false);
        this.$nextTick(() =>
          this.auditDrawer.reclaimFocus(this.$refs.analysisForm?.$el),
        );
      }
    },
    release() {
      if (
        this.decisionOrigin === 'LOCAL' &&
        window.confirm(this.$t('message.assessment_release_confirm'))
      ) {
        return this.changeOwnership('RELEASE_LOCAL');
      }
    },
    async reloadForReview() {
      this.auditDrawer.setSaving(true);
      try {
        await this.load();
        this.review = { ...this.loaded };
        this.actionFailed = false;
      } catch {
        this.actionFailed = true;
      } finally {
        this.auditDrawer.setSaving(false);
      }
    },
    acceptReview() {
      this.conflict = false;
      this.review = null;
      this.actionFailed = false;
    },
    async reloadAfterMutation() {
      this.auditDrawer.setSaving(true);
      try {
        await this.load();
        this.refreshFailed = false;
        this.actionFailed = false;
      } catch {
        this.actionFailed = true;
      } finally {
        this.auditDrawer.setSaving(false);
      }
    },
    fieldLabel(field) {
      return this.$t(
        `message.${{ analysisState: 'analysis_state', analysisJustification: 'justification', analysisResponse: 'response', analysisDetails: 'details', isSuppressed: 'suppressed' }[field]}`,
      );
    },
    fieldValue(field, value) {
      if (field === 'analysisDetails')
        return value || this.$t('message.not_set');
      if (typeof value === 'boolean')
        return this.$t(value ? 'admin.enabled' : 'admin.disabled');
      return this.$t(`message.${value.toLowerCase()}`);
    },
  },
  beforeMount() {
    this.load().catch(() => (this.failed = true));
  },
};
</script>
