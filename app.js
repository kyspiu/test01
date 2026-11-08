const STORAGE_KEY = "mowik-sentences";
const REACTION_STORAGE_KEY = "mowik-reactions";
const REACTION_ID_PREFIX = "__mowik_reaction__";
const REACTION_DEFAULTS_MIGRATION_KEY = "mowik-reaction-defaults-v1";
const DEFAULT_REACTIONS = [
  { key: "dobrze", text: "Dobrze" },
  { key: "srednio", text: "Średnio" },
  { key: "zle", text: "Źle" }
];
const NUMBER_STORAGE_KEY = "mowik-numbers";
const NUMBER_ID_PREFIX = "__mowik_number__";
const DATE_STORAGE_KEY = "mowik-dates";
const DATE_ID_PREFIX = "__mowik_date__";
const QUICK_RESPONSE_IDS = {
  yes: "__mowik_quick_response_yes__",
  no: "__mowik_quick_response_no__"
};

let currentUser = null;
let activeRecording = null;
let activeSentenceId = null;
let recordingRequestPending = false;
let accessCheckPending = false;
let editingItemId = null;
const expandedCollectionActionsIds = new Set();
let openSpecialSentenceId = null;
let supportsSpecialWords = null;

const state = {
  sentenceList: [],
  reactionList: [],
  numberList: [],
  dateList: [],
  quickResponses: {
    yes: { id: QUICK_RESPONSE_IDS.yes, text: "TAK", audioUrl: "" },
    no: { id: QUICK_RESPONSE_IDS.no, text: "NIE", audioUrl: "" }
  }
};

const sentenceList = document.getElementById("sentenceList");
const sentenceInput = document.getElementById("sentenceInput");
const specialSentenceInput = document.getElementById("specialSentenceInput");
const btnAddSentence = document.getElementById("btnAddSentence");
const sentenceCount = document.getElementById("sentenceCount");
const appStatus = document.getElementById("appStatus");
const quickResponses = document.querySelector(".quick-responses");
const reactionList = document.getElementById("reactionList");
const reactionInput = document.getElementById("reactionInput");
const btnAddReaction = document.getElementById("btnAddReaction");
const numberList = document.getElementById("numberList");
const numberInput = document.getElementById("numberInput");
const btnAddNumber = document.getElementById("btnAddNumber");
const dateList = document.getElementById("dateList");
const dateInput = document.getElementById("dateInput");
const btnAddDate = document.getElementById("btnAddDate");
const scrollShortcuts = document.querySelector(".scroll-shortcuts");
const scrollShortcutsToggle = document.getElementById("scrollShortcutsToggle");
const scrollShortcutLinks = document.getElementById("scrollShortcutLinks");
const appShell = document.getElementById("appShell");
const accessGate = document.getElementById("accessGate");
const accessHeading = document.getElementById("accessHeading");
const accessMessage = document.getElementById("accessMessage");
const accessStatus = document.getElementById("accessStatus");
const accountEmail = document.getElementById("accountEmail");
const signOutButton = document.getElementById("signOutButton");
const accessSignOutButton = document.getElementById("accessSignOutButton");
const signOutButtons = [signOutButton, accessSignOutButton];

function getScopedStorageKey(storageKey) {
  if (!currentUser) {
    throw new Error("Nie można odczytać danych bez zalogowanego użytkownika.");
  }
  return `${storageKey}:${currentUser.id}`;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadItemList(storageKey, itemType) {
  try {
    const saved = JSON.parse(localStorage.getItem(getScopedStorageKey(storageKey)) || "null");
    if (Array.isArray(saved)) {
      return saved.map((item) => ({
        id: typeof item.id === "string" ? item.id : createId(),
        text: String(item.text || "").trim(),
        audioUrl: typeof item.audioUrl === "string" ? item.audioUrl : "",
        special: item.special === true,
        specialWords: Array.isArray(item.specialWords)
          ? item.specialWords.map((word) => ({
            id: typeof word.id === "string" ? word.id : createId(),
            text: String(word.text || "").trim(),
            audioUrl: typeof word.audioUrl === "string" ? word.audioUrl : ""
          })).filter((word) => word.text)
          : []
      })).filter((item) => item.text);
    }
  } catch (error) {
    console.warn(`Nie udało się odczytać zapisanych elementów (${itemType}).`, error);
  }

  return [];
}

function loadSentenceList() {
  return loadItemList(STORAGE_KEY, "zdania");
}

function loadReactionList() {
  return loadItemList(REACTION_STORAGE_KEY, "reakcje");
}

function saveSentenceList() {
  try {
    localStorage.setItem(getScopedStorageKey(STORAGE_KEY), JSON.stringify(state.sentenceList));
  } catch (error) {
    console.error("Nie udało się zapisać zdań lokalnie:", error);
    showStatus("Nie udało się zapisać zmian na tym urządzeniu.");
  }
}

function saveReactionList() {
  try {
    localStorage.setItem(getScopedStorageKey(REACTION_STORAGE_KEY), JSON.stringify(state.reactionList));
  } catch (error) {
    console.error("Nie udało się zapisać reakcji lokalnie:", error);
    showStatus("Nie udało się zapisać zmian na tym urządzeniu.");
  }
}

function saveNumberList() {
  try {
    localStorage.setItem(getScopedStorageKey(NUMBER_STORAGE_KEY), JSON.stringify(state.numberList));
  } catch (error) {
    console.error("Nie udało się zapisać liczb lokalnie:", error);
    showStatus("Nie udało się zapisać zmian na tym urządzeniu.");
  }
}

function saveDateList() {
  try {
    localStorage.setItem(getScopedStorageKey(DATE_STORAGE_KEY), JSON.stringify(state.dateList));
  } catch (error) {
    console.error("Nie udało się zapisać dat lokalnie:", error);
    showStatus("Nie udało się zapisać zmian na tym urządzeniu.");
  }
}

function saveItemLocally(item) {
  const sentenceOwner = state.sentenceList.find((sentence) =>
    sentence.id === item.id || sentence.specialWords.some((word) => word.id === item.id));
  if (sentenceOwner) {
    saveSentenceList();
    return;
  }
  if (item.id.startsWith(REACTION_ID_PREFIX)) {
    saveReactionList();
  } else if (item.id.startsWith(NUMBER_ID_PREFIX)) {
    saveNumberList();
  } else if (item.id.startsWith(DATE_ID_PREFIX)) {
    saveDateList();
  }
}

function getPersistedItem(item) {
  return state.sentenceList.find((sentence) =>
    sentence.id === item.id || sentence.specialWords.some((word) => word.id === item.id))
    || state.reactionList.find((reaction) => reaction.id === item.id)
    || state.numberList.find((number) => number.id === item.id)
    || state.dateList.find((date) => date.id === item.id)
    || Object.values(state.quickResponses).find((response) => response.id === item.id)
    || item;
}

function showStatus(message) {
  appStatus.textContent = message;
}

function showAccessGate(heading, message, canSignOut = false) {
  appShell.hidden = true;
  accessGate.hidden = false;
  accessHeading.textContent = heading;
  accessMessage.textContent = message;
  accessStatus.textContent = "";
  accessSignOutButton.hidden = !canSignOut;
}

function createRecordingIndicator(label) {
  const indicator = document.createElement("span");
  indicator.className = "recorded-indicator";
  indicator.textContent = "✓";
  indicator.setAttribute("role", "img");
  indicator.setAttribute("aria-label", label);
  indicator.title = label;
  return indicator;
}

function getItemKind(id) {
  if (id.startsWith(REACTION_ID_PREFIX)) return "reakcja";
  if (id.startsWith(NUMBER_ID_PREFIX)) return "liczba";
  if (id.startsWith(DATE_ID_PREFIX)) return "data";
  return "zdanie";
}

function getSentenceCountLabel(count) {
  if (count === 1) {
    return "zdanie";
  }
  if (count >= 2 && count <= 4) {
    return "zdania";
  }
  return "zdań";
}

async function loadItemsFromSupabase() {
  if (!supabaseClient) return;

  let result = await supabaseClient
    .from("sentence_items")
    .select("id, text, audio_url, special_words")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: true });

  if (result.error && isMissingSpecialWordsColumn(result.error)) {
    supportsSpecialWords = false;
    console.warn("Kolumna special_words nie istnieje jeszcze w Supabase. Uruchom aktualny supabase.sql, aby synchronizować zdania specjalne.");
    result = await supabaseClient
      .from("sentence_items")
      .select("id, text, audio_url")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: true });
  } else if (!result.error) {
    supportsSpecialWords = true;
  }

  if (result.error || !result.data) {
    if (result.error) {
      console.error("Nie udało się pobrać elementów z Supabase:", result.error);
      showStatus("Nie udało się pobrać danych. Sprawdź połączenie i spróbuj ponownie.");
    }
    return;
  }

  const remoteSentences = [];
  const remoteReactions = [];
  const remoteNumbers = [];
  const remoteDates = [];
  result.data.forEach((item) => {
    const id = String(item.id);
    const quickResponse = Object.values(state.quickResponses).find((response) => response.id === id);
    if (quickResponse) {
      quickResponse.audioUrl = item.audio_url || "";
    } else if (id.startsWith(REACTION_ID_PREFIX)) {
      remoteReactions.push({
        id,
        text: item.text,
        audioUrl: item.audio_url || ""
      });
    } else if (id.startsWith(NUMBER_ID_PREFIX)) {
      remoteNumbers.push({
        id,
        text: item.text,
        audioUrl: item.audio_url || ""
      });
    } else if (id.startsWith(DATE_ID_PREFIX)) {
      remoteDates.push({
        id,
        text: item.text,
        audioUrl: item.audio_url || ""
      });
    } else {
      remoteSentences.push({
        id,
        text: item.text,
        audioUrl: item.audio_url || "",
        special: Array.isArray(item.special_words),
        specialWords: Array.isArray(item.special_words) ? item.special_words : []
      });
    }
  });

  if (!supportsSpecialWords) {
    const localSpecialSentences = state.sentenceList.filter((item) => item.special);
    const remoteIds = new Set(remoteSentences.map((item) => item.id));
    remoteSentences.forEach((item) => {
      const localSpecial = localSpecialSentences.find((localItem) => localItem.id === item.id);
      if (localSpecial) {
        item.special = true;
        item.specialWords = localSpecial.specialWords;
      }
    });
    remoteSentences.push(...localSpecialSentences.filter((item) => !remoteIds.has(item.id)));
  }
  if (remoteSentences.length > 0) {
    state.sentenceList = remoteSentences;
  }
  if (remoteReactions.length > 0) {
    state.reactionList = remoteReactions;
  }
  if (remoteNumbers.length > 0) {
    state.numberList = remoteNumbers;
  }
  if (remoteDates.length > 0) {
    state.dateList = remoteDates;
  }
  saveSentenceList();
  saveReactionList();
  saveNumberList();
  saveDateList();
  renderSentenceList();
  renderReactionList();
  renderNumberList();
  renderDateList();
  renderQuickResponses();
}

async function upsertItemInSupabase(item) {
  if (!supabaseClient) return false;

  const payload = {
    id: item.id,
    user_id: currentUser.id,
    text: item.text,
    audio_url: item.audioUrl || null,
    special_words: Array.isArray(item.specialWords) ? item.specialWords : []
  };

  const { error } = await supabaseClient
    .from("sentence_items")
    .upsert(payload, { onConflict: "id" });

  if (error) {
    if (isMissingSpecialWordsColumn(error)) {
      supportsSpecialWords = false;
      const { error: fallbackError } = await supabaseClient
        .from("sentence_items")
        .upsert({
          id: item.id,
          user_id: currentUser.id,
          text: item.text,
          audio_url: item.audioUrl || null
        }, { onConflict: "id" });
      if (fallbackError) {
        console.error("Błąd zapisu elementu do Supabase:", fallbackError);
        return false;
      }
      if (item.special || item.specialWords && item.specialWords.length > 0) {
        console.warn("Dodatkowe słowa zapisano lokalnie. Uruchom aktualny supabase.sql, aby zsynchronizować je z Supabase.");
        return false;
      }
      return true;
    }
    console.error("Błąd zapisu elementu do Supabase:", error);
    return false;
  }

  if (supportsSpecialWords === false && (item.special || item.specialWords && item.specialWords.length > 0)) {
    console.warn("Dodatkowe słowa zapisano lokalnie. Uruchom aktualny supabase.sql, aby zsynchronizować je z Supabase.");
    return false;
  }

  supportsSpecialWords = true;
  return true;
}

function isMissingSpecialWordsColumn(error) {
  return (error.code === "42703" || error.code === "PGRST204")
    && /special_words/i.test(error.message || "");
}

async function deleteItemFromSupabase(id) {
  if (!supabaseClient) return false;

  const { error } = await supabaseClient
    .from("sentence_items")
    .delete()
    .eq("id", id)
    .eq("user_id", currentUser.id);

  if (error) {
    console.error("Błąd usuwania elementu z Supabase:", error);
    return false;
  }
  return true;
}

async function playSentenceAudio(sentence) {
  if (!sentence.audioUrl) {
    const persistedItem = getPersistedItem(sentence);
    const itemKind = getItemKind(sentence.id);
    const message = itemKind === "reakcja"
      ? "Ta reakcja nie ma jeszcze nagrania."
      : itemKind === "liczba"
        ? "Ta liczba nie ma jeszcze nagrania."
        : itemKind === "data"
          ? "Ta data nie ma jeszcze nagrania."
          : persistedItem.id !== sentence.id
            ? "To słowo nie ma jeszcze nagrania."
            : "To zdanie nie ma jeszcze nagrania.";
    showStatus(message);
    return;
  }

  try {
    const audioUrl = await getSignedAudioUrl(sentence.audioUrl);
    const audio = new Audio(audioUrl);
    await audio.play();
    showStatus(`Odtwarzam: ${sentence.text}`);
  } catch (error) {
    console.warn("Nie udało się odtworzyć audio:", sentence.text, error);
    showStatus("Nie udało się odtworzyć nagrania.");
  }
}

async function playSpecialWord(sentence, word) {
  if (!sentence.audioUrl) {
    showStatus("To zdanie nie ma jeszcze nagrania.");
    return;
  }
  if (!word.audioUrl) {
    showStatus("To słowo nie ma jeszcze nagrania.");
    return;
  }

  try {
    showStatus(`Odtwarzam: ${sentence.text}, potem ${word.text}`);
    await playAudioClip(sentence.audioUrl);
    await playAudioClip(word.audioUrl);
  } catch (error) {
    console.warn("Nie udało się odtworzyć zdania specjalnego:", sentence.text, word.text, error);
    showStatus("Nie udało się odtworzyć zdania i dodatkowego słowa.");
  }
}

function playAudioClip(audioUrl) {
  return getSignedAudioUrl(audioUrl).then((signedUrl) => new Promise((resolve, reject) => {
    const audio = new Audio(signedUrl);
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", () => reject(new Error("Nagranie audio nie jest dostępne.")), { once: true });
    audio.play().catch(reject);
  }));
}

async function getSignedAudioUrl(storagePath) {
  const expectedPrefix = `${currentUser.id}/`;
  if (typeof storagePath !== "string" || !storagePath.startsWith(expectedPrefix)) {
    throw new Error("Nagranie nie należy do zalogowanego użytkownika.");
  }
  const { data, error } = await supabaseClient.storage
    .from("sentence-audio")
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

function renderQuickResponses() {
  quickResponses.querySelectorAll(".quick-response").forEach((container) => {
    const response = state.quickResponses[container.dataset.response];
    if (!response) {
      return;
    }

    const playButton = container.querySelector(".quick-response-play");
    const recordButton = container.querySelector(".quick-response-record");
    const status = container.querySelector(".quick-response-status");
    const isRecording = activeSentenceId === response.id;
    const hasRecording = Boolean(response.audioUrl && !isRecording);

    playButton.setAttribute("aria-label", `Odtwórz ${response.text}`);
    playButton.title = response.audioUrl ? `Odtwórz ${response.text}` : "Najpierw nagraj odpowiedź";
    recordButton.textContent = isRecording ? "Zatrzymaj" : "Nagraj";
    recordButton.setAttribute("aria-label", `${isRecording ? "Zatrzymaj nagrywanie" : "Nagraj"} ${response.text}`);
    status.textContent = hasRecording ? "✓" : "";
    status.classList.toggle("recorded-indicator", hasRecording);
    container.classList.toggle("has-recording", hasRecording);
    if (hasRecording) {
      const label = `Nagrana szybka odpowiedź: ${response.text}`;
      status.setAttribute("role", "img");
      status.setAttribute("aria-label", label);
      status.title = label;
    } else {
      status.removeAttribute("role");
      status.removeAttribute("aria-label");
      status.removeAttribute("title");
    }
  });
}

quickResponses.addEventListener("click", async (event) => {
  const container = event.target.closest(".quick-response");
  if (!container) {
    return;
  }
  const response = state.quickResponses[container.dataset.response];
  if (!response) {
    return;
  }

  if (event.target.closest(".quick-response-play")) {
    playSentenceAudio(response);
  } else if (event.target.closest(".quick-response-record")) {
    await toggleRecording(response);
  }
});

function renderReactionList() {
  renderCollectionList(state.reactionList, reactionList, {
    stateKey: "reactionList",
    kind: "reakcja",
    accusative: "reakcję",
    genitive: "reakcji",
    emptyText: "Brak reakcji"
  });
}

function renderNumberList() {
  renderCollectionList(state.numberList, numberList, {
    stateKey: "numberList",
    kind: "liczba",
    accusative: "liczbę",
    genitive: "liczby",
    emptyText: "Brak liczb"
  });
}

function renderDateList() {
  renderCollectionList(state.dateList, dateList, {
    stateKey: "dateList",
    kind: "data",
    accusative: "datę",
    genitive: "daty",
    emptyText: "Brak dat"
  });
}

async function initializeDefaultReactions() {
  const migrationKey = getScopedStorageKey(REACTION_DEFAULTS_MIGRATION_KEY);
  if (localStorage.getItem(migrationKey) === "true") {
    return;
  }

  const addedReactions = [];
  DEFAULT_REACTIONS.forEach((reaction) => {
    const alreadyExists = state.reactionList.some((item) =>
      item.text.toLocaleLowerCase("pl-PL") === reaction.text.toLocaleLowerCase("pl-PL"));
    if (!alreadyExists) {
      const item = {
        id: `${REACTION_ID_PREFIX}${currentUser.id}_default_${reaction.key}`,
        text: reaction.text,
        audioUrl: ""
      };
      addedReactions.push(item);
    }
  });

  if (addedReactions.length > 0) {
    state.reactionList = [...addedReactions, ...state.reactionList];
    saveReactionList();
    renderReactionList();
  }

  const syncResults = await Promise.all(addedReactions.map(upsertItemInSupabase));
  if (syncResults.every(Boolean)) {
    try {
      localStorage.setItem(migrationKey, "true");
    } catch (error) {
      console.error("Nie udało się zapisać statusu domyślnych reakcji:", error);
    }
  } else {
    showStatus("Dodano domyślne reakcje na tym urządzeniu, ale nie udało się ich zsynchronizować z serwerem.");
  }
}

function renderCollectionList(items, container, config) {
  container.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "reaction-empty";
    empty.setAttribute("role", "listitem");
    empty.textContent = config.emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "reaction-card";
    card.setAttribute("role", "listitem");
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, input")) {
        return;
      }
      playSentenceAudio(item);
    });

    const isEditing = editingItemId === item.id;
    const isRecording = activeSentenceId === item.id;
    const actionsExpanded = expandedCollectionActionsIds.has(item.id);
    let itemInput;
    if (isEditing) {
      itemInput = document.createElement("input");
      itemInput.className = "reaction-edit-input";
      itemInput.type = "text";
      itemInput.maxLength = 80;
      itemInput.value = item.text;
      itemInput.setAttribute("aria-label", `Edytuj ${config.accusative}: ${item.text}`);
      itemInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveItemEdit(item, itemInput);
        } else if (event.key === "Escape") {
          editingItemId = null;
          renderCollectionList(items, container, config);
        }
      });
      queueMicrotask(() => itemInput.focus());
      card.appendChild(itemInput);
    } else {
      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "reaction-play";
      playButton.textContent = item.text;
      playButton.title = item.audioUrl ? `Odtwórz ${config.accusative}` : `Najpierw nagraj ${config.accusative}`;
      playButton.setAttribute("aria-label", `Odtwórz ${config.accusative}: ${item.text}`);
      playButton.addEventListener("click", () => playSentenceAudio(item));
      card.appendChild(playButton);
    }

    if (item.audioUrl && !isRecording && !isEditing) {
      card.classList.add("has-recording");
      card.appendChild(createRecordingIndicator(`Nagranie reakcji: ${item.text}`));
    }

    const controls = document.createElement("div");
    controls.className = "reaction-card-controls";

    const actionsToggle = document.createElement("button");
    actionsToggle.type = "button";
    actionsToggle.className = "reaction-actions-toggle";
    actionsToggle.textContent = "…";
    actionsToggle.title = `${actionsExpanded ? "Ukryj" : "Pokaż"} akcje: ${item.text}`;
    actionsToggle.setAttribute("aria-label", actionsToggle.title);
    actionsToggle.setAttribute("aria-expanded", String(actionsExpanded));
    const actionsId = `${container.id}-actions-${index}`;
    actionsToggle.setAttribute("aria-controls", actionsId);
    actionsToggle.addEventListener("click", () => {
      const isExpanded = expandedCollectionActionsIds.has(item.id);
      const nextExpanded = !isExpanded;
      if (nextExpanded) {
        expandedCollectionActionsIds.add(item.id);
      } else {
        expandedCollectionActionsIds.delete(item.id);
      }
      const label = `${nextExpanded ? "Ukryj" : "Pokaż"} akcje: ${item.text}`;
      actionsToggle.title = label;
      actionsToggle.setAttribute("aria-label", label);
      actionsToggle.setAttribute("aria-expanded", String(nextExpanded));
      actions.hidden = !nextExpanded;
    });
    controls.appendChild(actionsToggle);

    const actions = document.createElement("div");
    actions.className = "reaction-actions";
    actions.id = actionsId;
    actions.hidden = !actionsExpanded;

    if (isEditing) {
      const saveButton = createReactionAction("✓", `Zapisz ${config.accusative}`, "edit");
      saveButton.addEventListener("click", () => saveItemEdit(item, itemInput));
      const cancelButton = createReactionAction("×", "Anuluj edycję", "");
      cancelButton.addEventListener("click", () => {
        editingItemId = null;
        renderCollectionList(items, container, config);
      });
      actions.append(saveButton, cancelButton);
    } else {
      const editButton = createReactionAction("✎", `Edytuj ${config.accusative}: ${item.text}`, "edit");
      editButton.addEventListener("click", () => {
        editingItemId = item.id;
        expandedCollectionActionsIds.add(item.id);
        renderCollectionList(items, container, config);
      });

      const recordButton = createReactionAction(isRecording ? "■" : "●", `${isRecording ? "Zatrzymaj nagrywanie" : "Nagraj"} ${config.accusative}: ${item.text}`, "record");
      recordButton.addEventListener("click", async () => toggleRecording(item));

      const deleteButton = createReactionAction("×", `Usuń ${config.accusative}: ${item.text}`, "delete");
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`Czy na pewno chcesz usunąć ${config.genitive} „${item.text}”?`)) {
          return;
        }
        state[config.stateKey] = state[config.stateKey].filter((listItem) => listItem.id !== item.id);
        expandedCollectionActionsIds.delete(item.id);
        saveItemLocally(item);
        const deleted = await deleteItemFromSupabase(item.id);
        if (!deleted) {
          showStatus(`${config.accusative} usunięto na tym urządzeniu, ale nie udało się zsynchronizować usunięcia z serwerem.`);
        }
        renderCollectionList(state[config.stateKey], container, config);
      });
      actions.append(editButton, recordButton, deleteButton);
    }

    controls.appendChild(actions);
    card.appendChild(controls);
    container.appendChild(card);
  });
}

function createReactionAction(symbol, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `reaction-action ${action}`;
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function renderSentenceList() {
  sentenceList.innerHTML = "";
  sentenceCount.textContent = `${state.sentenceList.length} ${getSentenceCountLabel(state.sentenceList.length)}`;

  if (state.sentenceList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sentence-empty";
    empty.textContent = "Brak zdań";
    sentenceList.appendChild(empty);
    return;
  }

  state.sentenceList.forEach((sentence) => {
    const entry = document.createElement("div");
    entry.className = "sentence-entry";
    const row = document.createElement("div");
    row.className = "sentence-row";
    row.title = sentence.audioUrl ? "Kliknij, aby odsłuchać nagranie" : "Kliknij, aby odtworzyć nagranie po dodaniu";

    const content = document.createElement("div");
    content.className = "sentence-content";

    if (editingItemId === sentence.id) {
      const editInput = document.createElement("input");
      editInput.className = "sentence-edit-input";
      editInput.type = "text";
      editInput.maxLength = 80;
      editInput.value = sentence.text;
      editInput.setAttribute("aria-label", `Edytuj zdanie: ${sentence.text}`);
      editInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveItemEdit(sentence, editInput);
        } else if (event.key === "Escape") {
          editingItemId = null;
          renderSentenceList();
        }
      });
      content.appendChild(editInput);
      queueMicrotask(() => editInput.focus());
    } else {
      const text = document.createElement("span");
      text.className = "sentence-text";
      text.tabIndex = 0;
      text.setAttribute("role", "button");
      text.setAttribute("aria-label", `Odtwórz zdanie: ${sentence.text}`);
      text.textContent = sentence.text;

      text.addEventListener("click", (event) => {
        event.stopPropagation();
        playSentenceAudio(sentence);
      });
      text.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          playSentenceAudio(sentence);
        }
      });
      content.appendChild(text);

      if (sentence.special) {
        const optionsButton = document.createElement("button");
        optionsButton.type = "button";
        optionsButton.className = "sentence-options-toggle";
        optionsButton.textContent = openSpecialSentenceId === sentence.id ? "−" : "+";
        optionsButton.title = openSpecialSentenceId === sentence.id
          ? "Zamknij dodatkowe słowa"
          : "Dodaj lub edytuj dodatkowe słowa";
        optionsButton.setAttribute("aria-label", optionsButton.title);
        optionsButton.setAttribute("aria-expanded", String(openSpecialSentenceId === sentence.id));
        optionsButton.addEventListener("click", () => {
          openSpecialSentenceId = openSpecialSentenceId === sentence.id ? null : sentence.id;
          renderSentenceList();
        });
        content.appendChild(optionsButton);
      }

      if (sentence.audioUrl && activeSentenceId !== sentence.id) {
        row.classList.add("has-recording");
        row.appendChild(createRecordingIndicator(`Nagranie zdania: ${sentence.text}`));
      }
    }

    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input")) {
        return;
      }
      playSentenceAudio(sentence);
    });
    const actions = document.createElement("div");
    actions.className = "sentence-actions";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "sentence-action delete";
    deleteButton.textContent = "Usuń";
    deleteButton.setAttribute("aria-label", `Usuń zdanie ${sentence.text}`);
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      state.sentenceList = state.sentenceList.filter((item) => item.id !== sentence.id);
      saveSentenceList();
      await deleteItemFromSupabase(sentence.id);
      renderSentenceList();
    });

    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className = "sentence-action record";
    recordButton.textContent = activeSentenceId === sentence.id
      ? "Zatrzymaj"
      : "Nagraj";
    recordButton.setAttribute("aria-label", `Nagraj: ${sentence.text}`);
    recordButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await toggleRecording(sentence);
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "sentence-action edit";
    editButton.textContent = editingItemId === sentence.id ? "Zapisz" : "Edytuj";
    editButton.setAttribute("aria-label", `${editingItemId === sentence.id ? "Zapisz" : "Edytuj"} zdanie ${sentence.text}`);
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (editingItemId === sentence.id) {
        saveItemEdit(sentence, content.querySelector(".sentence-edit-input"));
      } else {
        editingItemId = sentence.id;
        renderSentenceList();
      }
    });

    if (editingItemId === sentence.id) {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "sentence-action";
      cancelButton.textContent = "Anuluj";
      cancelButton.addEventListener("click", () => {
        editingItemId = null;
        renderSentenceList();
      });
      actions.append(editButton, cancelButton);
    } else {
      actions.append(deleteButton, editButton, recordButton);
    }
    row.append(content, actions);
    entry.appendChild(row);

    if (sentence.special && openSpecialSentenceId === sentence.id) {
      entry.appendChild(renderSpecialWords(sentence));
    }
    sentenceList.appendChild(entry);
  });
}

function renderSpecialWords(sentence) {
  const panel = document.createElement("section");
  panel.className = "special-words-panel";
  panel.setAttribute("aria-label", `Dodatkowe słowa do zdania: ${sentence.text}`);

  const heading = document.createElement("h3");
  heading.textContent = "Wybierz dodatkowe słowo";
  panel.appendChild(heading);

  const form = document.createElement("form");
  form.className = "special-word-composer";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.placeholder = "dodaj słowo, np. Agnieszki";
  input.setAttribute("aria-label", "Dodaj dodatkowe słowo");
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "composer-button add-button";
  addButton.textContent = "+ Dodaj słowo";
  form.append(input, addButton);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    sentence.specialWords.push({ id: createId(), text: value, audioUrl: "" });
    saveSentenceList();
    renderSentenceList();
    await syncSpecialSentence(sentence, "Słowo");
  });
  panel.appendChild(form);

  const words = document.createElement("div");
  words.className = "special-word-list";
  if (sentence.specialWords.length === 0) {
    const empty = document.createElement("p");
    empty.className = "special-word-empty";
    empty.textContent = "Dodaj słowa, które można wstawić do tego zdania.";
    words.appendChild(empty);
  } else {
    sentence.specialWords.forEach((word) => {
      words.appendChild(renderSpecialWord(sentence, word));
    });
  }
  panel.appendChild(words);
  return panel;
}

function renderSpecialWord(sentence, word) {
  const card = document.createElement("div");
  card.className = "special-word-card";
  const isEditing = editingItemId === word.id;
  const isRecording = activeSentenceId === word.id;

  if (isEditing) {
    const input = document.createElement("input");
    input.className = "special-word-edit-input";
    input.type = "text";
    input.maxLength = 80;
    input.value = word.text;
    input.setAttribute("aria-label", `Edytuj dodatkowe słowo: ${word.text}`);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveItemEdit(word, input);
      } else if (event.key === "Escape") {
        editingItemId = null;
        renderSentenceList();
      }
    });
    queueMicrotask(() => input.focus());
    card.appendChild(input);
  } else {
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "special-word-play";
    playButton.textContent = word.text;
    playButton.setAttribute("aria-label", `Odtwórz dodatkowe słowo: ${word.text}`);
    playButton.addEventListener("click", () => playSpecialWord(sentence, word));
    card.appendChild(playButton);
  }

  const actions = document.createElement("div");
  actions.className = "special-word-actions";
  if (isEditing) {
    const saveButton = createSpecialWordAction("Zapisz", "Zapisz słowo", "edit");
    saveButton.addEventListener("click", () => saveItemEdit(word, card.querySelector("input")));
    const cancelButton = createSpecialWordAction("Anuluj", "Anuluj edycję słowa", "");
    cancelButton.addEventListener("click", () => {
      editingItemId = null;
      renderSentenceList();
    });
    actions.append(saveButton, cancelButton);
  } else {
    const editButton = createSpecialWordAction("Edytuj", `Edytuj słowo ${word.text}`, "edit");
    editButton.addEventListener("click", () => {
      editingItemId = word.id;
      renderSentenceList();
    });
    const recordButton = createSpecialWordAction(
      isRecording ? "Zatrzymaj" : "Nagraj",
      `${isRecording ? "Zatrzymaj nagrywanie" : "Nagraj"} słowo ${word.text}`,
      "record"
    );
    recordButton.addEventListener("click", async () => toggleRecording(word));
    const deleteButton = createSpecialWordAction("Usuń", `Usuń słowo ${word.text}`, "delete");
    deleteButton.addEventListener("click", async () => {
      sentence.specialWords = sentence.specialWords.filter((item) => item.id !== word.id);
      saveSentenceList();
      renderSentenceList();
      await deleteSpecialWordRecording(word.id);
      await syncSpecialSentence(sentence, "Słowo");
    });
    actions.append(editButton, recordButton, deleteButton);
  }
  card.appendChild(actions);

  if (word.audioUrl && !isRecording && !isEditing) {
    card.classList.add("has-recording");
    card.appendChild(createRecordingIndicator(`Nagranie słowa: ${word.text}`));
  }
  return card;
}

function createSpecialWordAction(text, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `special-word-action ${action}`;
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

async function deleteSpecialWordRecording(wordId) {
  if (!supabaseClient) {
    return;
  }
  const { error } = await supabaseClient.storage
    .from("sentence-audio")
    .remove([`${currentUser.id}/${wordId}.webm`]);
  if (error) {
    console.error("Nie udało się usunąć nagrania dodatkowego słowa:", error);
  }
}

async function syncSpecialSentence(sentence, itemName) {
  const synced = await upsertItemInSupabase(sentence);
  showStatus(synced
    ? `${itemName} zapisane.`
    : `${itemName} zapisane na tym urządzeniu, ale nie udało się zsynchronizować go z serwerem.`);
}

async function saveItemEdit(sentence, input) {
  if (!input) {
    return;
  }

  const newText = input.value.trim();
  if (!newText) {
    const itemKind = getItemKind(sentence.id);
    const itemType = itemKind === "reakcja" ? "reakcji"
      : itemKind === "liczba" ? "liczby"
        : itemKind === "data" ? "daty"
          : getPersistedItem(sentence).id !== sentence.id ? "słowa" : "zdania";
    showStatus(`Treść ${itemType} nie może być pusta.`);
    input.focus();
    return;
  }

  const textChanged = newText !== sentence.text;
  sentence.text = newText;
  if (textChanged && sentence.audioUrl) {
    sentence.audioUrl = "";
    if (supabaseClient) {
      const { error } = await supabaseClient.storage
        .from("sentence-audio")
        .remove([`${currentUser.id}/${sentence.id}.webm`]);
      if (error) {
        console.error("Nie udało się usunąć starego nagrania:", error);
      }
    }
  }

  editingItemId = null;
  const persistedItem = getPersistedItem(sentence);
  saveItemLocally(persistedItem);
  renderSentenceList();
  renderReactionList();
  renderNumberList();
  renderDateList();
  const synced = await upsertItemInSupabase(persistedItem);
  const itemKind = getItemKind(sentence.id);
  const itemName = itemKind === "reakcja" ? "Reakcja"
    : itemKind === "liczba" ? "Liczba"
      : itemKind === "data" ? "Data"
        : persistedItem.id !== sentence.id ? "Słowo" : "Zdanie";
  showStatus(synced ? `${itemName} zapisane.` : `${itemName} zapisane na tym urządzeniu, ale nie udało się zsynchronizować go z serwerem.`);
}

function stopActiveRecording() {
  if (activeRecording && activeRecording.state !== "inactive") {
    activeRecording.stop();
  }
}

function getRecordingItem(id) {
  return state.sentenceList.find((item) => item.id === id)
    || state.sentenceList.flatMap((item) => item.specialWords).find((word) => word.id === id)
    || state.reactionList.find((item) => item.id === id)
    || state.numberList.find((item) => item.id === id)
    || state.dateList.find((item) => item.id === id)
    || Object.values(state.quickResponses).find((item) => item.id === id);
}

function getRecordingErrorMessage(error) {
  const permissionHelp = "Przeglądarka zablokowała dostęp do mikrofonu. Otwórz ustawienia uprawnień tej strony przy pasku adresu, ustaw Mikrofon na „Zezwalaj”, sprawdź też uprawnienia mikrofonu dla przeglądarki w ustawieniach urządzenia, a następnie odśwież stronę.";
  const errorName = error && error.name;

  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError" || errorName === "SecurityError") {
    return permissionHelp;
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "Nie znaleziono mikrofonu. Podłącz mikrofon lub wybierz dostępne urządzenie i spróbuj ponownie.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Nie można uruchomić mikrofonu. Sprawdź, czy nie używa go inna aplikacja i czy system zezwala przeglądarce na dostęp.";
  }
  if (errorName === "OverconstrainedError") {
    return "Nie można skonfigurować mikrofonu na tym urządzeniu. Sprawdź ustawienia urządzenia i spróbuj ponownie.";
  }
  if (errorName === "NotSupportedError") {
    return "Ta przeglądarka nie obsługuje formatu nagrywania audio wymaganego przez aplikację.";
  }
  return error && error.message
    ? `Nie udało się uruchomić mikrofonu: ${error.message}`
    : "Nie udało się uruchomić mikrofonu. Sprawdź ustawienia urządzenia i spróbuj ponownie.";
}

async function toggleRecording(sentence) {
  if (activeRecording && activeSentenceId === sentence.id) {
    activeRecording.stop();
    return;
  }

  if (activeRecording) {
    stopActiveRecording();
  }

  if (recordingRequestPending) {
    return;
  }

  recordingRequestPending = true;
  let stream;
  try {
    if (window.isSecureContext === false) {
      throw new Error("Nagrywanie wymaga bezpiecznego połączenia HTTPS. Otwórz aplikację przez adres zaczynający się od https://.");
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new Error("Ta przeglądarka nie obsługuje dostępu do mikrofonu. Otwórz Mówik w aktualnej wersji przeglądarki.");
    }
    if (typeof window.MediaRecorder !== "function") {
      throw new Error("Ta przeglądarka nie obsługuje nagrywania audio. Otwórz Mówik w aktualnej wersji przeglądarki.");
    }

    showStatus("Oczekiwanie na dostęp do mikrofonu…");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false }
      }
    });
    recordingRequestPending = false;
    const chunks = [];
    const mimeType = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    activeRecording = recorder;
    activeSentenceId = sentence.id;
    renderSentenceList();
    renderReactionList();
    renderNumberList();
    renderDateList();
    renderQuickResponses();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const item = getRecordingItem(sentence.id);
      const persistedItem = item && getPersistedItem(item);

      try {
        if (!item) {
          return;
        }
        if (blob.size === 0) {
          showStatus("Nagranie jest puste. Poprzednie nagranie pozostało bez zmian.");
          return;
        }
        if (!supabaseClient) {
          showStatus("Nie można zapisać nagrania bez połączenia z serwerem.");
          return;
        }

        const replacingRecording = Boolean(item.audioUrl);
        const fileName = `${currentUser.id}/${item.id}.webm`;
        const { error: uploadError } = await supabaseClient.storage
          .from("sentence-audio")
          .upload(fileName, blob, { contentType: blob.type || "audio/webm", upsert: true });

        if (uploadError) {
          throw uploadError;
        }

        item.audioUrl = fileName;

        saveItemLocally(item);
        const synced = await upsertItemInSupabase(persistedItem);
        if (synced) {
          showStatus(replacingRecording ? "Nagranie zastąpione nowym." : "Nagranie zapisane.");
        } else {
          showStatus("Nagranie zapisane, ale nie udało się zsynchronizować go z serwerem.");
        }
      } catch (uploadError) {
        console.error("Upload audio to Supabase failed:", uploadError);
        showStatus("Nie udało się zapisać nowego nagrania. Poprzednie nagranie pozostało bez zmian.");
      } finally {
        stream.getTracks().forEach((track) => track.stop());
        if (activeRecording === recorder) {
          activeRecording = null;
          activeSentenceId = null;
          renderSentenceList();
          renderReactionList();
          renderNumberList();
          renderDateList();
          renderQuickResponses();
        }
      }
    };

    recorder.start();
  } catch (error) {
    console.error("Nie udało się uruchomić mikrofonu:", error);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    activeRecording = null;
    activeSentenceId = null;
    recordingRequestPending = false;
    renderSentenceList();
    renderReactionList();
    renderNumberList();
    renderDateList();
    renderQuickResponses();
    showStatus(getRecordingErrorMessage(error));
  }
}

function addSentence() {
  const value = sentenceInput.value.trim();
  if (!value) {
    sentenceInput.focus();
    return;
  }

  const item = {
    id: createId(),
    text: value,
    audioUrl: "",
    special: specialSentenceInput.checked,
    specialWords: []
  };

  state.sentenceList.push(item);
  saveSentenceList();
  sentenceInput.value = "";
  specialSentenceInput.checked = false;
  renderSentenceList();
  upsertItemInSupabase(item).then((synced) => {
    if (!synced) {
      showStatus(item.special
        ? "Zdanie specjalne zapisane na tym urządzeniu, ale nie udało się zsynchronizować go z serwerem."
        : "Zdanie zapisane na tym urządzeniu, ale nie udało się zsynchronizować go z serwerem.");
    }
  });
  sentenceInput.focus();
}

function addReaction() {
  addCollectionItem(reactionInput, "reactionList", REACTION_ID_PREFIX, "reakcję");
}

function addNumber() {
  addCollectionItem(numberInput, "numberList", NUMBER_ID_PREFIX, "liczbę");
}

function addDate() {
  addCollectionItem(dateInput, "dateList", DATE_ID_PREFIX, "datę");
}

function addCollectionItem(input, stateKey, idPrefix, itemLabel) {
  const value = input.value.trim();
  if (!value) {
    input.focus();
    return;
  }

  const item = {
    id: `${idPrefix}${createId()}`,
    text: value,
    audioUrl: ""
  };

  state[stateKey].push(item);
  saveItemLocally(item);
  input.value = "";
  renderReactionList();
  renderNumberList();
  renderDateList();
  upsertItemInSupabase(item).then((synced) => {
    if (!synced) {
      showStatus(`Dodano ${itemLabel} lokalnie, ale nie udało się zsynchronizować z serwerem.`);
    }
  });
  input.focus();
  showStatus(`Dodano ${itemLabel}.`);
}

function handleSentenceInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addSentence();
  }
}

function handleReactionInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addReaction();
  }
}

function handleNumberInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addNumber();
  }
}

function handleDateInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addDate();
  }
}

btnAddSentence.addEventListener("click", addSentence);
sentenceInput.addEventListener("keydown", handleSentenceInputKeydown);
btnAddReaction.addEventListener("click", addReaction);
reactionInput.addEventListener("keydown", handleReactionInputKeydown);
btnAddNumber.addEventListener("click", addNumber);
numberInput.addEventListener("keydown", handleNumberInputKeydown);
btnAddDate.addEventListener("click", addDate);
dateInput.addEventListener("keydown", handleDateInputKeydown);

async function initializeUser(user) {
  currentUser = user;
  expandedCollectionActionsIds.clear();
  state.sentenceList = loadSentenceList();
  state.reactionList = loadReactionList();
  state.numberList = loadItemList(NUMBER_STORAGE_KEY, "liczby");
  state.dateList = loadItemList(DATE_STORAGE_KEY, "daty");
  state.quickResponses.yes.id = `${user.id}${QUICK_RESPONSE_IDS.yes}`;
  state.quickResponses.no.id = `${user.id}${QUICK_RESPONSE_IDS.no}`;
  accountEmail.textContent = user.email || "";
  appShell.hidden = false;
  renderSentenceList();
  renderReactionList();
  renderNumberList();
  renderDateList();
  renderQuickResponses();
  await loadItemsFromSupabase();
  await initializeDefaultReactions();
}

async function isAccountBlocked(user) {
  const { data, error } = await supabaseClient
    .from("account_access")
    .select("is_blocked")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return false;
  if (!data || typeof data !== "object") {
    throw new Error("Status blokady konta jest niedostępny.");
  }
  if (typeof data.is_blocked !== "boolean") {
    throw new Error("Status blokady konta ma nieprawidłowy format.");
  }
  return data.is_blocked;
}

async function recheckAccountAccess() {
  if (!currentUser || accessCheckPending) return;
  accessCheckPending = true;
  try {
    if (await isAccountBlocked(currentUser)) {
      showAccessGate(
        "Konto zablokowane",
        "Konto zablokowane — skontaktuj się z administratorem.",
        true
      );
    }
  } catch (error) {
    console.error("Nie udało się potwierdzić statusu konta:", error);
    showAccessGate(
      "Nie można potwierdzić statusu konta",
      "Aplikacja pozostaje zablokowana, ponieważ nie udało się odczytać statusu konta. Skontaktuj się z administratorem.",
      true
    );
  } finally {
    accessCheckPending = false;
  }
}

async function startAuthenticatedApp() {
  if (!supabaseClient) {
    showAccessGate(
      "Nie można potwierdzić statusu konta",
      "Nie można połączyć z usługą danych. Aplikacja pozostaje zablokowana. Odśwież stronę lub skontaktuj się z administratorem."
    );
    return;
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("login.html");
    } else if (session && currentUser && session.user.id !== currentUser.id) {
      window.location.reload();
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    window.location.replace("login.html");
    return;
  }
  let blocked;
  try {
    blocked = await isAccountBlocked(data.session.user);
  } catch (error) {
    console.error("Nie udało się potwierdzić statusu konta:", error);
    showAccessGate(
      "Nie można potwierdzić statusu konta",
      "Aplikacja pozostaje zablokowana, ponieważ nie udało się odczytać statusu konta. Skontaktuj się z administratorem.",
      true
    );
    return;
  }
  if (blocked) {
    showAccessGate(
      "Konto zablokowane",
      "Konto zablokowane — skontaktuj się z administratorem.",
      true
    );
    return;
  }
  accessGate.hidden = true;
  await initializeUser(data.session.user);
}

async function signOut() {
  signOutButtons.forEach((signOutButtonElement) => {
    signOutButtonElement.disabled = true;
  });
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    window.location.replace("login.html");
  } catch (error) {
    console.error("Nie udało się wylogować:", error);
    if (!accessGate.hidden) {
      accessStatus.textContent = "Nie udało się wylogować. Spróbuj ponownie.";
    } else {
      showStatus("Nie udało się wylogować. Spróbuj ponownie.");
    }
    signOutButtons.forEach((signOutButtonElement) => {
      signOutButtonElement.disabled = false;
    });
  }
}

signOutButtons.forEach((button) => {
  button.addEventListener("click", signOut);
});

window.addEventListener("focus", recheckAccountAccess);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    recheckAccountAccess();
  }
});
window.setInterval(recheckAccountAccess, 60_000);

scrollShortcutsToggle.addEventListener("click", () => {
  const isCollapsed = scrollShortcuts.classList.toggle("is-collapsed");
  scrollShortcutsToggle.setAttribute("aria-expanded", String(!isCollapsed));
  scrollShortcutsToggle.setAttribute("aria-label", isCollapsed ? "Rozwiń skróty" : "Zwiń skróty");
  scrollShortcutsToggle.querySelector("span").textContent = isCollapsed ? "‹" : "›";
  scrollShortcutLinks.querySelectorAll("a").forEach((link) => {
    link.tabIndex = isCollapsed ? -1 : 0;
  });
});

startAuthenticatedApp().catch((error) => {
  console.error("Nie udało się uruchomić aplikacji:", error);
  showAccessGate(
    "Nie można potwierdzić statusu konta",
    "Aplikacja pozostaje zablokowana. Odśwież stronę lub skontaktuj się z administratorem.",
    Boolean(currentUser)
  );
});
