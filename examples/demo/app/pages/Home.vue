<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { createStyleSheet } from '@thelacanians/vue-native-runtime';
import {
  isAuthError,
  useProviderLogin,
} from '@franciscodlxdev/vue-native-auth-core';
import type {
  CodeRequiredStep,
  EntraStep,
} from '@franciscodlxdev/vue-native-entra-native-auth';
import { ENTRA_DEMO, ENTRA_REAL, ENTRA_REDIRECT_URI, entra } from '../entra';
import {
  PROVIDERS,
  X_LOGIN,
  X_OPTIONS,
  X_PROVIDER,
  xSummary,
  type DemoProvider,
  type SignedIn,
} from '../providers';

function describeError(error: unknown): string {
  return isAuthError(error)
    ? `ERROR ${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}

// Providers that go through a backend, and Entra.
const working = ref(false);
const result = shallowRef<SignedIn | null>(null);
const error = ref<string | null>(null);

// X: the composable owns loading, result and error.
const x = useProviderLogin(X_LOGIN, X_OPTIONS);
const xProfile = computed(() => {
  try {
    return x.result.value ? xSummary(x.result.value.profile) : null;
  } catch (e) {
    return describeError(e);
  }
});
const lastWasX = ref(false);

const busy = computed(() => working.value || x.loading.value);
const signedIn = computed(() =>
  lastWasX.value
    ? typeof xProfile.value === 'object'
      ? xProfile.value
      : null
    : result.value
);
const failure = computed(() => {
  if (!lastWasX.value) return error.value;
  if (x.error.value) return describeError(x.error.value);
  return typeof xProfile.value === 'string' ? xProfile.value : null;
});

async function signInWithX(): Promise<void> {
  lastWasX.value = true;
  await x.signIn();
}

async function run(next: () => Promise<SignedIn | null>): Promise<void> {
  lastWasX.value = false;
  working.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await next();
  } catch (e) {
    error.value = describeError(e);
  } finally {
    working.value = false;
  }
}

function signIn(provider: DemoProvider): Promise<void> {
  return run(() => provider.signIn());
}

// Entra (native auth): email and password, or a one-time code.
const email = ref(ENTRA_DEMO.email);
const password = ref(ENTRA_DEMO.password);
const code = ref(ENTRA_DEMO.code);
const entraStep = shallowRef<CodeRequiredStep | null>(null);

function entraSignIn(): Promise<void> {
  return runEntra(() =>
    entra.signIn({
      username: email.value,
      password: password.value || undefined,
    })
  );
}

function entraSubmitCode(): Promise<void> {
  const step = entraStep.value;
  return step
    ? runEntra(() => entra.submitCode(step, code.value))
    : Promise.resolve();
}

function runEntra(next: () => Promise<EntraStep>): Promise<void> {
  return run(async () => {
    let step = await next();
    if (step.type === 'browser_required') {
      const tokens = await entra.signInWithBrowser({
        redirectUri: ENTRA_REDIRECT_URI,
        loginHint: step.username,
      });
      step = { type: 'signed_in', tokens };
    }
    if (step.type === 'code_required') {
      entraStep.value = step;
      return null;
    }
    if (step.type !== 'signed_in') {
      throw new Error(`Entra needs "${step.type}"; this demo only signs in.`);
    }
    entraStep.value = null;
    const claims = step.tokens.idTokenClaims ?? {};
    return {
      provider: 'Entra',
      id: String(step.tokens.profile?.id ?? claims.sub ?? ''),
      name: step.tokens.profile?.name,
      email: step.tokens.profile?.email,
    };
  });
}

const styles = createStyleSheet({
  page: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8, color: '#1f2328' },
  note: { fontSize: 13, color: '#57606a', marginBottom: 8 },
  button: { borderRadius: 8, marginVertical: 4, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 15 },
  section: { fontSize: 17, fontWeight: 'bold', marginTop: 16, color: '#1f2328' },
  field: { borderBottomWidth: 1, borderColor: '#d0d7de', paddingVertical: 8, marginBottom: 4, fontSize: 15 },
  ok: { color: '#0a7d32', fontWeight: 'bold' },
  bad: { color: '#b00020', fontWeight: 'bold', marginBottom: 12 },
  mono: { fontFamily: 'monospace', fontSize: 13, color: '#1f2328' },
  result: { marginBottom: 12 },
});
</script>

<template>
  <VScrollView :style="{ flex: 1 }">
    <VView :style="styles.page">
      <VText :style="styles.title">Social login · Vue Native</VText>
      <VText :style="styles.note">
        Providers without a client ID in app/config.ts use the local mocks.
      </VText>

      <VActivityIndicator v-if="busy" :animating="true" />
      <VText
        v-else-if="failure"
        :style="styles.bad"
        accessibilityLabel="error"
        >{{ failure }}</VText
      >
      <VView v-else-if="signedIn" :style="styles.result" accessibilityLabel="result">
        <VText :style="styles.ok">SIGNED IN ({{ signedIn.provider }})</VText>
        <VText :style="styles.mono">id: {{ signedIn.id }}</VText>
        <VText :style="styles.mono">name: {{ signedIn.name }}</VText>
        <VText :style="styles.mono">username: {{ signedIn.username }}</VText>
        <VText :style="styles.mono">email: {{ signedIn.email }}</VText>
      </VView>

      <!-- X goes through the useProviderLogin composable. -->
      <VButton
        :style="[styles.button, { backgroundColor: X_PROVIDER.color }]"
        :disabled="busy"
        accessibilityLabel="sign-in-x"
        :onPress="signInWithX"
      >
        <VText :style="styles.buttonText"
          >Sign in with X{{ X_PROVIDER.real ? '' : ' (mock)' }}</VText
        >
      </VButton>

      <!-- The rest exchange the code on a backend (see providers.ts). -->
      <VButton
        v-for="provider in PROVIDERS"
        :key="provider.id"
        :style="[styles.button, { backgroundColor: provider.color }]"
        :disabled="busy"
        :accessibilityLabel="`sign-in-${provider.id}`"
        :onPress="() => signIn(provider)"
      >
        <VText :style="styles.buttonText"
          >Sign in with {{ provider.label }}{{ provider.real ? '' : ' (mock)' }}</VText
        >
      </VButton>

      <VText :style="styles.section"
        >Microsoft Entra (native auth){{ ENTRA_REAL ? '' : ' · mock' }}</VText
      >
      <VInput
        v-model="email"
        :style="styles.field"
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <VInput
        v-model="password"
        :style="styles.field"
        placeholder="Password (empty: email code)"
        :secureTextEntry="true"
      />
      <template v-if="entraStep">
        <VInput
          v-model="code"
          :style="styles.field"
          :placeholder="`Code sent to ${entraStep.sentTo ?? entraStep.username}`"
          keyboardType="number-pad"
        />
        <VButton
          :style="[styles.button, { backgroundColor: '#0078d4' }]"
          :disabled="busy"
          accessibilityLabel="entra-code"
          :onPress="entraSubmitCode"
        >
          <VText :style="styles.buttonText">Submit code</VText>
        </VButton>
      </template>
      <VButton
        v-else
        :style="[styles.button, { backgroundColor: '#0078d4' }]"
        :disabled="busy"
        accessibilityLabel="entra-sign-in"
        :onPress="entraSignIn"
      >
        <VText :style="styles.buttonText">Sign in with Entra</VText>
      </VButton>
    </VView>
  </VScrollView>
</template>
