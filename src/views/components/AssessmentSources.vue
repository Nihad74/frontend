<template>
  <div>
    <p class="small text-muted">
      {{ $t('message.assessment_sources_explanation') }}
    </p>
    <section
      v-for="source in sources"
      :key="`${source.project.uuid}/${source.component.uuid}`"
      class="mb-4"
      :aria-label="`${source.project.name} / ${source.component.name}`"
    >
      <dl class="audit-details">
        <dt>{{ $t('message.project_name') }}</dt>
        <dd>
          <router-link
            :to="{ name: 'Project', params: { uuid: source.project.uuid } }"
            >{{ source.project.name
            }}<template v-if="source.project.version">
              ({{ source.project.version }})</template
            ></router-link
          >
        </dd>
        <dt>{{ $t('message.component') }}</dt>
        <dd>
          <router-link
            :to="{ name: 'Component', params: { uuid: source.component.uuid } }"
            >{{ source.component.name
            }}<template v-if="source.component.version">
              ({{ source.component.version }})</template
            ></router-link
          >
        </dd>
        <template v-if="source.sourceDetails">
          <dt>{{ $t('message.details') }}</dt>
          <dd class="audit-text">{{ source.sourceDetails }}</dd>
        </template>
      </dl>
      <h6>{{ $t('message.history') }}</h6>
      <audit-history :comments="source.comments || []" />
    </section>
  </div>
</template>

<script setup>
import AuditHistory from '@/views/components/AuditHistory.vue';

defineProps({ sources: { type: Array, required: true } });
</script>
