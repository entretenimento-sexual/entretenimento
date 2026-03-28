// src/app/preferences/components/preference-profile-form/preference-profile-form.component.ts
// Primeiro formulário inédito do domínio novo.
//
// Responsabilidade:
// - editar PreferenceProfile
// - não conhece legado
// - não persiste diretamente
// - emite o model pronto para a página/facade salvar
//
// Observação:
// - role não é salvo aqui
// - capabilities entram apenas para gating de UI/edição

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { PreferenceProfile } from '../../models/preference-profile.model';
import {
  BodyPreference,
  DiscoveryMode,
  GenderInterest,
  RelationshipIntent,
  SexualPractice,
} from '../../models/preference.types';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from '../../utils/preference-normalizers';

type Option<T extends string> = {
  key: T;
  label: string;
};

@Component({
  selector: 'app-preference-profile-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './preference-profile-form.component.html',
  styleUrl: './preference-profile-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferenceProfileFormComponent {
  readonly profile = input<PreferenceProfile | null>(null);
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);
  readonly saving = input<boolean>(false);

  readonly saveProfile = output<PreferenceProfile>();

  readonly relationshipIntentOptions: Array<Option<RelationshipIntent>> = [
    { key: 'friendship', label: 'Amizade' },
    { key: 'casual', label: 'Casual' },
    { key: 'dating', label: 'Dating' },
    { key: 'serious', label: 'Sério' },
    { key: 'open_relationship', label: 'Relacionamento aberto' },
    { key: 'polyamory', label: 'Poliamor' },
    { key: 'swing', label: 'Swing' },
    { key: 'fetish_exploration', label: 'Exploração fetichista' },
  ];

  readonly genderInterestOptions: Array<Option<GenderInterest>> = [
    { key: 'men', label: 'Homens' },
    { key: 'women', label: 'Mulheres' },
    { key: 'couple_mm', label: 'Casal MM' },
    { key: 'couple_mf', label: 'Casal MF' },
    { key: 'couple_ff', label: 'Casal FF' },
    { key: 'travestis', label: 'Travestis' },
    { key: 'trans_people', label: 'Pessoas trans' },
    { key: 'crossdressers', label: 'Crossdressers' },
    { key: 'non_binary', label: 'Não binário' },
    { key: 'intersex', label: 'Intersexo' },
    { key: 'drag_queen', label: 'Drag Queen' },
    { key: 'drag_king', label: 'Drag King' },
    { key: 'genderfluid', label: 'Genderfluid' },
    { key: 'agender', label: 'Agênero' },
    { key: 'genderqueer', label: 'Genderqueer' },
    { key: 'androgynous', label: 'Andrógino' },
  ];

  readonly sexualPracticeOptions: Array<Option<SexualPractice>> = [
    { key: 'vanilla', label: 'Sexo baunilha' },
    { key: 'bdsm', label: 'BDSM' },
    { key: 'voyeurism', label: 'Voyeurismo' },
    { key: 'exhibitionism', label: 'Exibicionismo' },
    { key: 'swing', label: 'Swing' },
    { key: 'menage', label: 'Menage' },
    { key: 'group_sex', label: 'Sexo grupal' },
    { key: 'roleplay', label: 'Roleplay' },
    { key: 'tantra', label: 'Tantra' },
    { key: 'dom_sub', label: 'Dominação e submissão' },
    { key: 'outdoor', label: 'Ao ar livre' },
    { key: 'fetishes', label: 'Fetiches' },
    { key: 'edge_play', label: 'Edge play' },
    { key: 'shibari', label: 'Shibari' },
    { key: 'cuckold', label: 'Cuckold' },
    { key: 'pegging', label: 'Pegging' },
    { key: 'sensory_play', label: 'Sensory play' },
    { key: 'dirty_talk', label: 'Dirty talk' },
  ];

  readonly bodyPreferenceOptions: Array<Option<BodyPreference>> = [
    { key: 'athletic', label: 'Atlético' },
    { key: 'plus_size', label: 'Plus size' },
    { key: 'tattoos', label: 'Tatuagens' },
    { key: 'piercings', label: 'Piercings' },
    { key: 'beard', label: 'Barba' },
    { key: 'long_hair', label: 'Cabelos longos' },
    { key: 'curly_hair', label: 'Cabelos cacheados' },
    { key: 'light_eyes', label: 'Olhos claros' },
    { key: 'muscular', label: 'Musculoso' },
    { key: 'slim', label: 'Magro' },
    { key: 'curvy', label: 'Curvilíneo' },
  ];

  readonly discoveryModeOptions: Array<Option<DiscoveryMode>> = [
    { key: 'standard', label: 'Padrão' },
    { key: 'discreet', label: 'Discreto' },
    { key: 'priority', label: 'Prioritário' },
  ];

  private readonly fb = new FormBuilder();

  readonly form = this.fb.nonNullable.group({
    maxDistanceKm: this.fb.control<number | null>(null),

    acceptsCouples: true,
    acceptsSingles: true,
    acceptsTransProfiles: this.fb.control<'all' | 'yes' | 'no'>('all'),
    locationRequired: false,

    showPreferenceBadges: true,
    showIntentPublicly: false,
    discoveryMode: this.fb.nonNullable.control<DiscoveryMode>('standard'),

    ri_friendship: false,
    ri_casual: false,
    ri_dating: false,
    ri_serious: false,
    ri_open_relationship: false,
    ri_polyamory: false,
    ri_swing: false,
    ri_fetish_exploration: false,

    gi_men: false,
    gi_women: false,
    gi_couple_mm: false,
    gi_couple_mf: false,
    gi_couple_ff: false,
    gi_travestis: false,
    gi_trans_people: false,
    gi_crossdressers: false,
    gi_non_binary: false,
    gi_intersex: false,
    gi_drag_queen: false,
    gi_drag_king: false,
    gi_genderfluid: false,
    gi_agender: false,
    gi_genderqueer: false,
    gi_androgynous: false,

    sp_vanilla: false,
    sp_bdsm: false,
    sp_voyeurism: false,
    sp_exhibitionism: false,
    sp_swing: false,
    sp_menage: false,
    sp_group_sex: false,
    sp_roleplay: false,
    sp_tantra: false,
    sp_dom_sub: false,
    sp_outdoor: false,
    sp_fetishes: false,
    sp_edge_play: false,
    sp_shibari: false,
    sp_cuckold: false,
    sp_pegging: false,
    sp_sensory_play: false,
    sp_dirty_talk: false,

    bp_athletic: false,
    bp_plus_size: false,
    bp_tattoos: false,
    bp_piercings: false,
    bp_beard: false,
    bp_long_hair: false,
    bp_curly_hair: false,
    bp_light_eyes: false,
    bp_muscular: false,
    bp_slim: false,
    bp_curvy: false,
  });

  readonly canEdit = computed(
    () => this.capabilities()?.canEditAdvancedPreferences ?? false
  );

  readonly canUseDiscreetMode = computed(
    () => this.capabilities()?.canUseDiscreetMode ?? false
  );

  constructor() {
    effect(() => {
      const profile = this.profile() ?? createEmptyPreferenceProfile('');
      this.patchForm(profile);
    });

    effect(() => {
      const canEdit = this.canEdit();
      const canUseDiscreet = this.canUseDiscreetMode();

      if (!canEdit) {
        this.form.disable({ emitEvent: false });
        return;
      }

      this.form.enable({ emitEvent: false });

      if (!canUseDiscreet && this.form.controls.discoveryMode.value === 'discreet') {
        this.form.controls.discoveryMode.setValue('standard', { emitEvent: false });
      }
    });
  }

  submit(): void {
    if (!this.canEdit()) return;
    if (this.form.invalid) return;

    const current = this.profile() ?? createEmptyPreferenceProfile('');

    const result: PreferenceProfile = {
      userId: current.userId,
      relationshipIntents: this.selectedRelationshipIntents(),
      hardRules: {
        acceptedGenders: this.selectedGenderInterests(),
        acceptedRelationshipIntents: this.selectedRelationshipIntents(),
        ageRange: current.hardRules.ageRange ?? null,
        maxDistanceKm: this.form.controls.maxDistanceKm.value ?? null,
        acceptsCouples: this.form.controls.acceptsCouples.value,
        acceptsSingles: this.form.controls.acceptsSingles.value,
        acceptsTransProfiles: this.readAcceptsTransProfiles(),
        locationRequired: this.form.controls.locationRequired.value,
      },
      softRules: {
        bodyPreferences: this.selectedBodyPreferences(),
        sexualPractices: this.selectedSexualPractices(),
        vibes: current.softRules.vibes ?? [],
        styles: current.softRules.styles ?? [],
        interests: current.softRules.interests ?? [],
      },
      visibility: {
        showPreferenceBadges: this.form.controls.showPreferenceBadges.value,
        showIntentPublicly: this.form.controls.showIntentPublicly.value,
        discoveryMode: this.normalizeDiscoveryMode(
          this.form.controls.discoveryMode.value
        ),
      },
      updatedAt: Date.now(),
    };

    this.saveProfile.emit(result);
  }

  private patchForm(profile: PreferenceProfile): void {
    this.form.patchValue(
      {
        maxDistanceKm: profile.hardRules.maxDistanceKm,
        acceptsCouples: profile.hardRules.acceptsCouples,
        acceptsSingles: profile.hardRules.acceptsSingles,
        acceptsTransProfiles: this.writeAcceptsTransProfiles(profile.hardRules.acceptsTransProfiles),
        locationRequired: profile.hardRules.locationRequired,
        showPreferenceBadges: profile.visibility.showPreferenceBadges,
        showIntentPublicly: profile.visibility.showIntentPublicly,
        discoveryMode: profile.visibility.discoveryMode,

        ri_friendship: profile.relationshipIntents.includes('friendship'),
        ri_casual: profile.relationshipIntents.includes('casual'),
        ri_dating: profile.relationshipIntents.includes('dating'),
        ri_serious: profile.relationshipIntents.includes('serious'),
        ri_open_relationship: profile.relationshipIntents.includes('open_relationship'),
        ri_polyamory: profile.relationshipIntents.includes('polyamory'),
        ri_swing: profile.relationshipIntents.includes('swing'),
        ri_fetish_exploration: profile.relationshipIntents.includes('fetish_exploration'),

        gi_men: profile.hardRules.acceptedGenders.includes('men'),
        gi_women: profile.hardRules.acceptedGenders.includes('women'),
        gi_couple_mm: profile.hardRules.acceptedGenders.includes('couple_mm'),
        gi_couple_mf: profile.hardRules.acceptedGenders.includes('couple_mf'),
        gi_couple_ff: profile.hardRules.acceptedGenders.includes('couple_ff'),
        gi_travestis: profile.hardRules.acceptedGenders.includes('travestis'),
        gi_trans_people: profile.hardRules.acceptedGenders.includes('trans_people'),
        gi_crossdressers: profile.hardRules.acceptedGenders.includes('crossdressers'),
        gi_non_binary: profile.hardRules.acceptedGenders.includes('non_binary'),
        gi_intersex: profile.hardRules.acceptedGenders.includes('intersex'),
        gi_drag_queen: profile.hardRules.acceptedGenders.includes('drag_queen'),
        gi_drag_king: profile.hardRules.acceptedGenders.includes('drag_king'),
        gi_genderfluid: profile.hardRules.acceptedGenders.includes('genderfluid'),
        gi_agender: profile.hardRules.acceptedGenders.includes('agender'),
        gi_genderqueer: profile.hardRules.acceptedGenders.includes('genderqueer'),
        gi_androgynous: profile.hardRules.acceptedGenders.includes('androgynous'),

        sp_vanilla: profile.softRules.sexualPractices.includes('vanilla'),
        sp_bdsm: profile.softRules.sexualPractices.includes('bdsm'),
        sp_voyeurism: profile.softRules.sexualPractices.includes('voyeurism'),
        sp_exhibitionism: profile.softRules.sexualPractices.includes('exhibitionism'),
        sp_swing: profile.softRules.sexualPractices.includes('swing'),
        sp_menage: profile.softRules.sexualPractices.includes('menage'),
        sp_group_sex: profile.softRules.sexualPractices.includes('group_sex'),
        sp_roleplay: profile.softRules.sexualPractices.includes('roleplay'),
        sp_tantra: profile.softRules.sexualPractices.includes('tantra'),
        sp_dom_sub: profile.softRules.sexualPractices.includes('dom_sub'),
        sp_outdoor: profile.softRules.sexualPractices.includes('outdoor'),
        sp_fetishes: profile.softRules.sexualPractices.includes('fetishes'),
        sp_edge_play: profile.softRules.sexualPractices.includes('edge_play'),
        sp_shibari: profile.softRules.sexualPractices.includes('shibari'),
        sp_cuckold: profile.softRules.sexualPractices.includes('cuckold'),
        sp_pegging: profile.softRules.sexualPractices.includes('pegging'),
        sp_sensory_play: profile.softRules.sexualPractices.includes('sensory_play'),
        sp_dirty_talk: profile.softRules.sexualPractices.includes('dirty_talk'),

        bp_athletic: profile.softRules.bodyPreferences.includes('athletic'),
        bp_plus_size: profile.softRules.bodyPreferences.includes('plus_size'),
        bp_tattoos: profile.softRules.bodyPreferences.includes('tattoos'),
        bp_piercings: profile.softRules.bodyPreferences.includes('piercings'),
        bp_beard: profile.softRules.bodyPreferences.includes('beard'),
        bp_long_hair: profile.softRules.bodyPreferences.includes('long_hair'),
        bp_curly_hair: profile.softRules.bodyPreferences.includes('curly_hair'),
        bp_light_eyes: profile.softRules.bodyPreferences.includes('light_eyes'),
        bp_muscular: profile.softRules.bodyPreferences.includes('muscular'),
        bp_slim: profile.softRules.bodyPreferences.includes('slim'),
        bp_curvy: profile.softRules.bodyPreferences.includes('curvy'),
      },
      { emitEvent: false }
    );
  }

  private selectedRelationshipIntents(): RelationshipIntent[] {
    const v = this.form.getRawValue();
    return [
      v.ri_friendship && 'friendship',
      v.ri_casual && 'casual',
      v.ri_dating && 'dating',
      v.ri_serious && 'serious',
      v.ri_open_relationship && 'open_relationship',
      v.ri_polyamory && 'polyamory',
      v.ri_swing && 'swing',
      v.ri_fetish_exploration && 'fetish_exploration',
    ].filter(Boolean) as RelationshipIntent[];
  }

  private selectedGenderInterests(): GenderInterest[] {
    const v = this.form.getRawValue();
    return [
      v.gi_men && 'men',
      v.gi_women && 'women',
      v.gi_couple_mm && 'couple_mm',
      v.gi_couple_mf && 'couple_mf',
      v.gi_couple_ff && 'couple_ff',
      v.gi_travestis && 'travestis',
      v.gi_trans_people && 'trans_people',
      v.gi_crossdressers && 'crossdressers',
      v.gi_non_binary && 'non_binary',
      v.gi_intersex && 'intersex',
      v.gi_drag_queen && 'drag_queen',
      v.gi_drag_king && 'drag_king',
      v.gi_genderfluid && 'genderfluid',
      v.gi_agender && 'agender',
      v.gi_genderqueer && 'genderqueer',
      v.gi_androgynous && 'androgynous',
    ].filter(Boolean) as GenderInterest[];
  }

  private selectedSexualPractices(): SexualPractice[] {
    const v = this.form.getRawValue();
    return [
      v.sp_vanilla && 'vanilla',
      v.sp_bdsm && 'bdsm',
      v.sp_voyeurism && 'voyeurism',
      v.sp_exhibitionism && 'exhibitionism',
      v.sp_swing && 'swing',
      v.sp_menage && 'menage',
      v.sp_group_sex && 'group_sex',
      v.sp_roleplay && 'roleplay',
      v.sp_tantra && 'tantra',
      v.sp_dom_sub && 'dom_sub',
      v.sp_outdoor && 'outdoor',
      v.sp_fetishes && 'fetishes',
      v.sp_edge_play && 'edge_play',
      v.sp_shibari && 'shibari',
      v.sp_cuckold && 'cuckold',
      v.sp_pegging && 'pegging',
      v.sp_sensory_play && 'sensory_play',
      v.sp_dirty_talk && 'dirty_talk',
    ].filter(Boolean) as SexualPractice[];
  }

  private selectedBodyPreferences(): BodyPreference[] {
    const v = this.form.getRawValue();
    return [
      v.bp_athletic && 'athletic',
      v.bp_plus_size && 'plus_size',
      v.bp_tattoos && 'tattoos',
      v.bp_piercings && 'piercings',
      v.bp_beard && 'beard',
      v.bp_long_hair && 'long_hair',
      v.bp_curly_hair && 'curly_hair',
      v.bp_light_eyes && 'light_eyes',
      v.bp_muscular && 'muscular',
      v.bp_slim && 'slim',
      v.bp_curvy && 'curvy',
    ].filter(Boolean) as BodyPreference[];
  }

  private readAcceptsTransProfiles(): boolean | null {
    const value = this.form.controls.acceptsTransProfiles.value;
    if (value === 'yes') return true;
    if (value === 'no') return false;
    return null;
  }

  private writeAcceptsTransProfiles(value: boolean | null | undefined): 'all' | 'yes' | 'no' {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return 'all';
  }

  private normalizeDiscoveryMode(value: DiscoveryMode): DiscoveryMode {
    if (value === 'discreet' && !this.canUseDiscreetMode()) {
      return 'standard';
    }

    return value;
  }
}