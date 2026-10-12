#!/usr/bin/env python3
# Builds the unsigned "Sisyphos weigh-in" shortcut; signing it is a separate
# step (HEALTH.md, Making the Shortcut). The token and the log repo are import
# questions, so the file carries neither.
import plistlib, sys, uuid

OBJ = "￼"
actions = []

def uid():
    return str(uuid.uuid4()).upper()

def var(name):
    return {"Type": "Variable", "VariableName": name}

def out(u, name):
    return {"Type": "ActionOutput", "OutputUUID": u, "OutputName": name}

def attach(a):
    return {"Value": a, "WFSerializationType": "WFTextTokenAttachment"}

def tokens(*parts):
    """Text with variables: parts are str or attachment dicts."""
    s, rng = "", {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            rng["{%d, 1}" % (len(s.encode("utf-16-le")) // 2)] = p  # UTF-16 offset
            s += OBJ
    return {"Value": {"string": s, "attachmentsByRange": rng},
            "WFSerializationType": "WFTextTokenString"}

def act(ident, **params):
    u = uid()
    params.setdefault("UUID", u)
    actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions." + ident,
                    "WFWorkflowActionParameters": params})
    return params["UUID"]

def setvar(name, source):
    act("setvariable", WFVariableName=name, WFInput=attach(source))

def text(name, *parts):
    u = act("gettext", WFTextActionText=tokens(*parts))
    setvar(name, out(u, "Text"))

def cond(input_attachment, op, value=None):
    g = uid()
    p = {"WFControlFlowMode": 0, "GroupingIdentifier": g, "WFCondition": op,
         "WFInput": {"Type": "Variable", "Variable": attach(input_attachment)}}
    if value is not None:
        p["WFConditionalActionString"] = value
    act("conditional", **p)
    return g

def otherwise(g):
    act("conditional", WFControlFlowMode=1, GroupingIdentifier=g)

def endif(g):
    act("conditional", WFControlFlowMode=2, GroupingIdentifier=g)

IS, IS_NOT, CONTAINS, HAS_VALUE, NO_VALUE = 4, 5, 99, 100, 101

def headers(token, accept="application/vnd.github+json"):
    # no-cache: a second run within a minute must not see the first run's cached GET
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": tokens(k), "WFValue": tokens(*v)} for k, v in [
            ("Authorization", ["Bearer ", token]),
            ("Accept", [accept]),
            ("X-GitHub-Api-Version", ["2022-11-28"]),
            ("Cache-Control", ["no-cache"]),
        ]]}, "WFSerializationType": "WFDictionaryFieldValue"}

def replace(name, source, find, repl, regex=True):
    u = act("text.replace", WFReplaceTextFind=find, WFReplaceTextReplace=repl,
            WFReplaceTextRegularExpression=regex,
            WFInput=source if "WFSerializationType" in source else tokens(source))
    setvar(name, out(u, "Updated Text"))

def jsonbody(fields):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": tokens(k), "WFValue": tokens(*v)} for k, v in fields]},
        "WFSerializationType": "WFDictionaryFieldValue"}

# 0, 1: answered by the import questions
text("token", "PASTE-TOKEN-HERE")
text("repo", "OWNER/REPO")
text("url", "https://api.github.com/repos/", var("repo"), "/contents/lifter/bodyweight.csv")

# Latest weight sample. "Today" is checked below rather than in the filter.
find = act("filter.health.quantity",
    WFContentItemFilter={"Value": {
        "WFActionParameterFilterPrefix": 1,
        "WFContentPredicateBoundedDate": False,
        "WFActionParameterFilterTemplates": [{
            "Bounded": True, "Operator": IS, "Property": "Type", "Removable": False,
            "Values": {"Enumeration": {"Value": "Weight",
                                       "WFSerializationType": "WFStringSubstitutableState"}},
        }]}, "WFSerializationType": "WFContentPredicateTableTemplate"},
    WFContentItemSortProperty="Start Date",
    WFContentItemSortOrder="Latest First",
    WFContentItemLimitEnabled=True,
    WFContentItemLimitNumber=1.0)
setvar("sample", out(find, "Health Samples"))
g = cond(var("sample"), NO_VALUE); act("exit"); endif(g)

def detail(prop, name):
    u = act("properties.health.quantity", WFContentItemPropertyName=prop,
            WFInput=attach(var("sample")))
    setvar(name, out(u, prop))

detail("Value", "weightraw")
detail("Unit", "unitraw")
text("unit", var("unitraw"))
detail("Start Date", "taken")

# day must be today
u = act("format.date", WFDateFormatStyle="Custom", WFDateFormat="yyyy-MM-dd",
        WFDate=tokens(var("taken")))
setvar("day", out(u, "Formatted Date"))
u = act("format.date", WFDateFormatStyle="Custom", WFDateFormat="yyyy-MM-dd",
        WFDate=tokens({"Type": "CurrentDate"}))
setvar("today", out(u, "Formatted Date"))
g = cond(var("day"), IS_NOT, tokens(var("today"))); act("exit"); endif(g)

# kg as text. Shortcuts parses numbers with a decimal point but prints them in
# the phone's locale, so a number round trip turned 79,95 into 7995.
text("weight", var("weightraw"))
replace("weight", var("weight"), "[^0-9.,]", "")
replace("weight", var("weight"), ",", ".", regex=False)
g = cond(var("unit"), CONTAINS, "lb")
u = act("math", WFMathOperation="×", WFMathOperand=0.45359237, WFInput=attach(var("weight")))
u = act("round", WFRoundTo="Hundredths Place", WFRoundMode="Normal",
        WFInput=attach(out(u, "Calculation Result")))
text("weight", out(u, "Rounded Number"))
replace("weight", var("weight"), "[^0-9.,]", "")
replace("weight", var("weight"), ",", ".", regex=False)
endif(g)
# At most 2 decimals, no trailing zeros (DATA.md, Serialisation)
replace("kg", var("weight"), "^([0-9]+\\.[0-9]{2})[0-9]+$", "$1")
replace("kg", var("kg"), "(\\.[0-9]*?)0+$", "$1")
replace("kg", var("kg"), "\\.$", "")
# Anything but 20-399 kg with up to 2 decimals is not written
replace("bad", tokens(var("kg"), "x"), "^([2-9][0-9]|[1-3][0-9]{2})(\\.[0-9]{1,2})?x$", "ok")
# Empty text counts as a value in an If, so a valid weight becomes "ok"
g = cond(var("bad"), IS_NOT, "ok")
act("notification", WFNotificationActionTitle="Sisyphos",
    WFNotificationActionBody=tokens("Weigh-in not sent: weight read as ", var("weightraw")))
act("exit")
endif(g)

# Current file: sha from the JSON form, text from the raw form (no Base64 decode)
get = act("downloadurl", WFURL=tokens(var("url")), WFHTTPMethod="GET",
          ShowHeaders=True, WFHTTPHeaders=headers(var("token")))
u = act("getvalueforkey", WFGetDictionaryValueType="Value", WFDictionaryKey="sha",
        WFInput=attach(out(get, "Contents of URL")))
setvar("sha", out(u, "Dictionary Value"))
g = cond(var("sha"), NO_VALUE)
text("csv", "date,weight_kg,source\n")
otherwise(g)
raw = act("downloadurl", WFURL=tokens(var("url")), WFHTTPMethod="GET",
          ShowHeaders=True, WFHTTPHeaders=headers(var("token"), "application/vnd.github.raw"))
text("csv", out(raw, "Contents of URL"))
endif(g)

# Never overwrite a day. Every data row follows a newline (the header comes first).
g = cond(var("csv"), CONTAINS, tokens(var("day"), ",")); act("exit"); endif(g)

# Ensure a trailing newline, then append
n = act("text.replace", WFReplaceTextFind="(?<!\\n)\\z", WFReplaceTextReplace="\n",
        WFReplaceTextRegularExpression=True, WFInput=tokens(var("csv")))
t = act("gettext", WFTextActionText=tokens(out(n, "Updated Text"),
                                           var("day"), ",", var("kg"), ",import\n"))
e = act("base64encode", WFEncodeMode="Encode", WFBase64LineBreakMode="None",
        WFInput=attach(out(t, "Text")))
setvar("encoded", out(e, "Base64 Encoded"))

message = ("message", ["health: bodyweight ", var("day")])
content = ("content", [var("encoded")])
g = cond(var("sha"), NO_VALUE)
p = act("downloadurl", WFURL=tokens(var("url")), WFHTTPMethod="PUT", ShowHeaders=True,
        WFHTTPHeaders=headers(var("token")), WFHTTPBodyType="JSON",
        WFJSONValues=jsonbody([message, content]))
setvar("response", out(p, "Contents of URL"))
otherwise(g)
p = act("downloadurl", WFURL=tokens(var("url")), WFHTTPMethod="PUT", ShowHeaders=True,
        WFHTTPHeaders=headers(var("token")), WFHTTPBodyType="JSON",
        WFJSONValues=jsonbody([message, content, ("sha", [var("sha")])]))
setvar("response", out(p, "Contents of URL"))
endif(g)

u = act("getvalueforkey", WFGetDictionaryValueType="Value", WFDictionaryKey="commit",
        WFInput=attach(var("response")))
g = cond(out(u, "Dictionary Value"), NO_VALUE)
act("notification", WFNotificationActionTitle="Sisyphos",
    WFNotificationActionBody="Weigh-in not sent. The next run retries.")
endif(g)

shortcut = {
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": False,
    "WFWorkflowImportQuestions": [
        {"ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "DefaultValue": "", "Text": "Paste the GitHub token made for this Shortcut (log repo only, Contents: read and write)"},
        {"ActionIndex": 2, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "DefaultValue": "OWNER/REPO", "Text": "Your log repo, as OWNER/REPO"},
    ],
    "WFWorkflowActions": actions,
}
with open(sys.argv[1], "wb") as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
