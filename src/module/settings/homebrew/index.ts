import { MenuTemplateData, SettingsMenuPF2e } from '../menu';
import Tagify from '@yaireo/tagify';
import { prepareCleanup } from './cleanup-migration';
import { LocalizePF2e } from '@module/system/localize';
import { MigrationRunner } from '@module/migration-runner';
import '@yaireo/tagify/src/tagify.scss';

export type ConfigPF2eListName = typeof HomebrewElements.SETTINGS[number];
export type HomebrewSettingsKey = `homebrew.${ConfigPF2eListName}`;

export interface HomebrewTag<T extends ConfigPF2eListName = ConfigPF2eListName> {
    id: string;
    value: T;
}

export class HomebrewElements extends SettingsMenuPF2e {
    static readonly namespace = 'homebrew';

    static readonly SETTINGS = [
        'creatureTraits',
        'languages',
        'spellSchools',
        'weaponCategories',
        'weaponGroups',
        'baseWeapons',
    ] as const;

    /** @override */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: 'PF2E.SETTINGS.Homebrew.Name',
            id: 'homebrew-settings',
            template: 'systems/pf2e/templates/system/settings/homebrew.html',
            width: 550,
            height: 'auto',
            closeOnSubmit: true,
        });
    }

    /** @override */
    protected static get settings(): Record<ConfigPF2eListName, ClientSettingsData> {
        return this.SETTINGS.map((key): { key: ConfigPF2eListName; value: ClientSettingsData } => {
            return {
                key,
                value: {
                    name: CONFIG.PF2E.SETTINGS.homebrew[key].name,
                    hint: CONFIG.PF2E.SETTINGS.homebrew[key].hint,
                    scope: 'world',
                    config: false,
                    default: [],
                    type: Object,
                },
            };
        }).reduce(
            (settings, setting) => mergeObject(settings, { [setting.key]: setting.value }),
            {} as Record<ConfigPF2eListName, ClientSettingsData & { placeholder: string }>,
        );
    }

    /** @override */
    getData(): MenuTemplateData {
        const data = super.getData();
        for (const setting of data.settings) {
            setting.value = JSON.stringify(setting.value);
        }
        return data;
    }

    /** @override */
    activateListeners($form: JQuery<HTMLFormElement>): void {
        super.activateListeners($form);

        $form.find('button[name="reset"]').on('click', () => {
            this.render();
        });

        for (const key of HomebrewElements.SETTINGS) {
            const $input = $form.find<HTMLInputElement>(`input[name="${key}"]`);
            new Tagify($input[0], {
                editTags: 1,
                hooks: {
                    beforeRemoveTag: (tags): Promise<void> => {
                        const translations = LocalizePF2e.translations.PF2E.SETTINGS.Homebrew.ConfirmDelete;
                        const response: Promise<unknown> = (async () => {
                            const content = game.i18n.format(translations.Message, { element: tags[0].data.value });
                            return await Dialog.confirm({
                                title: translations.Title,
                                content: `<p>${content}</p>`,
                            });
                        })();
                        return (async () => ((await response) ? Promise.resolve() : Promise.reject()))();
                    },
                },
            });
        }
    }

    /**
     * Tagify sets an empty input field to "" instead of "[]", which later causes the JSON parse to throw an error
     * @override
     */
    protected async _onSubmit(
        event: Event,
        { updateData = null, preventClose = false, preventRender = false }: OnSubmitFormOptions = {},
    ): Promise<Record<string, unknown>> {
        const $form = $<HTMLFormElement>(this.form);
        $form.find<HTMLInputElement>('tags ~ input').each((_i, input) => {
            if (input.value === '') {
                input.value = '[]';
            }
        });
        return super._onSubmit(event, { updateData, preventClose, preventRender });
    }

    /** @override */
    protected async _updateObject(_event: Event, data: Record<ConfigPF2eListName, HomebrewTag[]>): Promise<void> {
        for await (const key of HomebrewElements.SETTINGS) {
            for (const tag of data[key]) {
                tag.id ??= randomID(16);
            }

            await this.processDeletions(key, data[key]);
        }

        await super._updateObject(_event, data);

        // Process updates
        HomebrewElements.updateConfig();
    }

    /** Prepare and run a migration for each set of tag deletions from a tag map */
    private async processDeletions(listKey: ConfigPF2eListName, newTagList: HomebrewTag[]) {
        const oldTagList = game.settings.get('pf2e', `homebrew.${listKey}` as const); // `;
        const newIDList = newTagList.map((tag) => tag.id);
        const deletions: string[] = oldTagList.flatMap((oldTag) => (newIDList.includes(oldTag.id) ? [] : oldTag.id));

        // The base-weapons map only exists in the localization file
        const coreElements: Record<string, string> =
            listKey === 'baseWeapons' ? LocalizePF2e.translations.PF2E.Weapon.Base : CONFIG.PF2E[listKey];
        for (const id of deletions) {
            delete coreElements[id];
        }

        if (game.user.isGM && deletions.length > 0) {
            const CleanupTask = prepareCleanup(listKey, deletions);
            await new MigrationRunner().runMigrations([new CleanupTask()]);
        }
    }

    /** Assign the homebrew elements to their respective `CONFIG.PF2E` objects */
    static updateConfig() {
        for (const key of HomebrewElements.SETTINGS) {
            // The base-weapons map only exists in the localization file
            const coreElements: Record<string, string> =
                key === 'baseWeapons' ? LocalizePF2e.translations.PF2E.Weapon.Base : CONFIG.PF2E[key];
            const settingsKey: HomebrewSettingsKey = `homebrew.${key}` as const;
            const elements = game.settings.get('pf2e', settingsKey);
            for (const element of elements) {
                coreElements[element.id] = element.value;
            }
        }
    }
}
