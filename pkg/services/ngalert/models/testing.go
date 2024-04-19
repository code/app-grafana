package models

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/prometheus/common/model"
	"github.com/stretchr/testify/require"

	"github.com/grafana/grafana/pkg/expr"
	"github.com/grafana/grafana/pkg/services/datasources"
	"github.com/grafana/grafana/pkg/services/folder"
	"github.com/grafana/grafana/pkg/util"
)

type AlertRuleMutator func(g *AlertRuleGenerator, r *AlertRule)

func NewAlertRuleGenerator(t *testing.T, prefix string) *AlertRuleGenerator {
	seed := time.Now().UnixNano()
	if t != nil {
		t.Helper()
		t.Log(fmt.Sprintf("Rule generator seed: %d", seed))
	}
	g := &AlertRuleGenerator{
		r:      rand.New(rand.NewSource(seed)),
		prefix: prefix,
	}
	return g.With(g.WithUniqueUID(), g.WithUniqueTitle())
}

type AlertRuleGenerator struct {
	AlertRuleMutators
	r        *rand.Rand
	prefix   string
	mutators []AlertRuleMutator
}

func (g *AlertRuleGenerator) With(mutators ...AlertRuleMutator) *AlertRuleGenerator {
	return &AlertRuleGenerator{
		r:        g.r,
		prefix:   g.prefix,
		mutators: append(g.mutators, mutators...),
	}
}

// AlertRuleGen provides a factory function that generates a random AlertRule.
// The mutators arguments allows changing fields of the resulting structure
func AlertRuleGen(mutators ...AlertRuleMutator) func() *AlertRule {
	g := NewAlertRuleGenerator(nil, "test")
	return func() *AlertRule {
		r := g.With(mutators...).Generate()
		return &r
	}
}

func (g *AlertRuleGenerator) Generate() AlertRule {
	randNoDataState := func() NoDataState {
		s := [...]NoDataState{
			Alerting,
			NoData,
			OK,
		}
		return s[g.r.Intn(len(s))]
	}

	randErrState := func() ExecutionErrorState {
		s := [...]ExecutionErrorState{
			AlertingErrState,
			ErrorErrState,
			OkErrState,
		}
		return s[g.r.Intn(len(s))]
	}

	interval := (g.r.Int63n(6) + 1) * 10
	forInterval := time.Duration(interval*g.r.Int63n(6)) * time.Second

	var annotations map[string]string = nil
	if g.r.Int63()%2 == 0 {
		annotations = GenerateAlertLabels(g.r.Intn(5), fmt.Sprintf("%s-ann-", g.prefix))
	}
	var labels map[string]string = nil
	if g.r.Int63()%2 == 0 {
		labels = GenerateAlertLabels(g.r.Intn(5), fmt.Sprintf("%s-lbl-", g.prefix))
	}

	var dashUID *string = nil
	var panelID *int64 = nil
	if g.r.Int63()%2 == 0 {
		d := util.GenerateShortUID()
		dashUID = &d
		p := g.r.Int63n(1500)
		panelID = &p
	}

	var ns []NotificationSettings
	if g.r.Int63()%2 == 0 {
		ns = append(ns, NotificationSettingsGen()())
	}
	rule := AlertRule{
		ID:                   0,
		OrgID:                g.r.Int63n(1500) + 1, // Prevent OrgID=0 as this does not pass alert rule validation.
		Title:                fmt.Sprintf("%s-title-%s", g.prefix, util.GenerateShortUID()),
		Condition:            "A",
		Data:                 []AlertQuery{GenerateAlertQuery()},
		Updated:              time.Now().Add(-time.Duration(g.r.Intn(100) + 1)),
		IntervalSeconds:      g.r.Int63n(60) + 1,
		Version:              g.r.Int63n(1500), // Don't generate a rule ID too big for postgres
		UID:                  util.GenerateShortUID(),
		NamespaceUID:         util.GenerateShortUID(),
		DashboardUID:         dashUID,
		PanelID:              panelID,
		RuleGroup:            fmt.Sprintf("%s-group-%s,", g.prefix, util.GenerateShortUID()),
		RuleGroupIndex:       g.r.Intn(1500),
		NoDataState:          randNoDataState(),
		ExecErrState:         randErrState(),
		For:                  forInterval,
		Annotations:          annotations,
		Labels:               labels,
		NotificationSettings: ns,
	}

	for _, mutator := range g.mutators {
		mutator(g, &rule)
	}
	return rule
}

func (g *AlertRuleGenerator) GenerateRef() *AlertRule {
	r := g.Generate()
	return &r
}

func (g *AlertRuleGenerator) GenerateMany(count int) []AlertRule {
	result := make([]AlertRule, 0, count)
	for i := 0; i < count; i++ {
		result = append(result, g.Generate())
	}
	return result
}

func (g *AlertRuleGenerator) GenerateManyRef(count int) []*AlertRule {
	result := make([]*AlertRule, 0, count)
	for i := 0; i < count; i++ {
		r := g.Generate()
		result = append(result, &r)
	}
	return result
}

type AlertRuleMutators struct {
}

func (a *AlertRuleMutators) WithNotEmptyLabels(count int, prefix string) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.Labels = GenerateAlertLabels(count, prefix)
	}
}

func (a *AlertRuleMutators) WithUniqueID() AlertRuleMutator {
	ids := sync.Map{}
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		id := rule.ID
		for {
			_, exists := ids.LoadOrStore(id, struct{}{})
			if !exists {
				rule.ID = id
				return
			}
			id = g.r.Int63n(1500) + 1
		}
	}
}

func (a *AlertRuleMutators) WithGroupIndex(groupIndex int) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.RuleGroupIndex = groupIndex
	}
}

func (a *AlertRuleMutators) WithUniqueGroupIndex() AlertRuleMutator {
	usedIdx := sync.Map{}
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		idx := rule.RuleGroupIndex
		for {
			if _, exists := usedIdx.LoadOrStore(idx, struct{}{}); !exists {
				rule.RuleGroupIndex = idx
				return
			}
			idx = g.r.Int()
		}
	}
}

func (a *AlertRuleMutators) WithSequentialGroupIndex() AlertRuleMutator {
	idx := 1
	m := sync.Mutex{}
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		m.Lock()
		defer m.Unlock()
		rule.RuleGroupIndex = idx
		idx++
	}
}

func (a *AlertRuleMutators) WithOrgID(orgId int64) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.OrgID = orgId
	}
}

func (a *AlertRuleMutators) WithUniqueOrgID() AlertRuleMutator {
	orgs := sync.Map{}
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		orgID := rule.OrgID
		for {
			if _, exist := orgs.LoadOrStore(orgID, struct{}{}); !exist {
				rule.OrgID = orgID
				return
			}
			orgID = g.r.Int63()
		}
	}
}

// WithNamespaceUIDNotIn generates a random namespace UID if it is among excluded
func (a *AlertRuleMutators) WithNamespaceUIDNotIn(exclude ...string) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		for {
			if !slices.Contains(exclude, rule.NamespaceUID) {
				return
			}
			rule.NamespaceUID = uuid.NewString()
		}
	}
}

func (a *AlertRuleMutators) WithNamespace(namespace *folder.Folder) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.NamespaceUID = namespace.UID
	}
}

func (a *AlertRuleMutators) WithInterval(interval time.Duration) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.IntervalSeconds = int64(interval.Seconds())
	}
}

func (a *AlertRuleMutators) WithIntervalMatching(baseInterval time.Duration) AlertRuleMutator {
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		rule.IntervalSeconds = int64(baseInterval.Seconds()) * (g.r.Int63n(10) + 1)
		rule.For = time.Duration(rule.IntervalSeconds*g.r.Int63n(9)+1) * time.Second
	}
}

func (a *AlertRuleMutators) WithIntervalBetween(min, max int64) AlertRuleMutator {
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		rule.IntervalSeconds = g.r.Int63n(max-min) + min
	}
}

func (a *AlertRuleMutators) WithTitle(title string) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.Title = title
	}
}

func (a *AlertRuleMutators) WithFor(duration time.Duration) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.For = duration
	}
}

func (a *AlertRuleMutators) WithForNTimes(timesOfInterval int64) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.For = time.Duration(rule.IntervalSeconds*timesOfInterval) * time.Second
	}
}

func (a *AlertRuleMutators) WithNoDataExecAs(nodata NoDataState) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.NoDataState = nodata
	}
}

func (a *AlertRuleMutators) WithErrorExecAs(err ExecutionErrorState) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.ExecErrState = err
	}
}

func (a *AlertRuleMutators) WithAnnotations(lbls data.Labels) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.Annotations = lbls
	}
}

func (a *AlertRuleMutators) WithAnnotation(key, value string) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		if rule.Annotations == nil {
			rule.Annotations = data.Labels{}
		}
		rule.Annotations[key] = value
	}
}

func (a *AlertRuleMutators) WithLabels(lbls data.Labels) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.Labels = lbls
	}
}

func (a *AlertRuleMutators) WithLabel(key, value string) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		if rule.Labels == nil {
			rule.Labels = data.Labels{}
		}
		rule.Labels[key] = value
	}
}

func (a *AlertRuleMutators) WithDashboardAndPanel(dashboardUID *string, panelID *int64) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.DashboardUID = dashboardUID
		rule.PanelID = panelID
	}
}

func (a *AlertRuleMutators) WithUniqueUID() AlertRuleMutator {
	uids := sync.Map{}
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		uid := rule.UID
		for {
			_, exist := uids.LoadOrStore(uid, struct{}{})
			if !exist {
				rule.UID = uid
				return
			}
			uid = util.GenerateShortUID()
		}
	}
}

func (a *AlertRuleMutators) WithUniqueTitle() AlertRuleMutator {
	titles := sync.Map{}
	return func(g *AlertRuleGenerator, rule *AlertRule) {
		title := rule.Title
		for {
			_, exist := titles.LoadOrStore(title, struct{}{})
			if !exist {
				rule.Title = title
				return
			}
			title = fmt.Sprintf("%s-title-%s", g.prefix, util.GenerateShortUID())
		}
	}
}

func (a *AlertRuleMutators) WithQuery(query ...AlertQuery) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.Data = query
		if len(query) > 1 {
			rule.Condition = query[0].RefID
		}
	}
}

func (a *AlertRuleMutators) WithGroupKey(groupKey AlertRuleGroupKey) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.RuleGroup = groupKey.RuleGroup
		rule.OrgID = groupKey.OrgID
		rule.NamespaceUID = groupKey.NamespaceUID
	}
}

func (a *AlertRuleMutators) WithNotificationSettingsGen(ns func() NotificationSettings) AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.NotificationSettings = []NotificationSettings{ns()}
	}
}

func (a *AlertRuleMutators) WithNoNotificationSettings() AlertRuleMutator {
	return func(_ *AlertRuleGenerator, rule *AlertRule) {
		rule.NotificationSettings = nil
	}
}

func GenerateAlertLabels(count int, prefix string) data.Labels {
	labels := make(data.Labels, count)
	for i := 0; i < count; i++ {
		labels[prefix+"key-"+util.GenerateShortUID()] = prefix + "value-" + util.GenerateShortUID()
	}
	return labels
}

func GenerateAlertQuery() AlertQuery {
	f := rand.Intn(10) + 5
	t := rand.Intn(f)

	return AlertQuery{
		DatasourceUID: util.GenerateShortUID(),
		Model: json.RawMessage(fmt.Sprintf(`{
			"%s": "%s",
			"%s":"%d"
		}`, util.GenerateShortUID(), util.GenerateShortUID(), util.GenerateShortUID(), rand.Int())),
		RelativeTimeRange: RelativeTimeRange{
			From: Duration(time.Duration(f) * time.Minute),
			To:   Duration(time.Duration(t) * time.Minute),
		},
		RefID:     util.GenerateShortUID(),
		QueryType: util.GenerateShortUID(),
	}
}

// GenerateUniqueAlertRules generates many random alert rules and makes sure that they have unique UID.
// It returns a tuple where first element is a map where keys are UID of alert rule and the second element is a slice of the same rules
func GenerateUniqueAlertRules(count int, f func() *AlertRule) (map[string]*AlertRule, []*AlertRule) {
	uIDs := make(map[string]*AlertRule, count)
	result := make([]*AlertRule, 0, count)
	for len(result) < count {
		rule := f()
		if _, ok := uIDs[rule.UID]; ok {
			continue
		}
		result = append(result, rule)
		uIDs[rule.UID] = rule
	}
	return uIDs, result
}

// GenerateAlertRulesSmallNonEmpty generates 1 to 5 rules using the provided generator
func GenerateAlertRulesSmallNonEmpty(f func() *AlertRule) []*AlertRule {
	return GenerateAlertRules(rand.Intn(4)+1, f)
}

// GenerateAlertRules generates many random alert rules. Does not guarantee that rules are unique (by UID)
func GenerateAlertRules(count int, f func() *AlertRule) []*AlertRule {
	result := make([]*AlertRule, 0, count)
	for len(result) < count {
		rule := f()
		result = append(result, rule)
	}
	return result
}

// GenerateRuleKey generates a random alert rule key
func GenerateRuleKey(orgID int64) AlertRuleKey {
	return AlertRuleKey{
		OrgID: orgID,
		UID:   util.GenerateShortUID(),
	}
}

// GenerateGroupKey generates a random group key
func GenerateGroupKey(orgID int64) AlertRuleGroupKey {
	return AlertRuleGroupKey{
		OrgID:        orgID,
		NamespaceUID: util.GenerateShortUID(),
		RuleGroup:    util.GenerateShortUID(),
	}
}

// CopyRule creates a deep copy of AlertRule
func CopyRule(r *AlertRule, mutators ...AlertRuleMutator) *AlertRule {
	result := AlertRule{
		ID:              r.ID,
		OrgID:           r.OrgID,
		Title:           r.Title,
		Condition:       r.Condition,
		Updated:         r.Updated,
		IntervalSeconds: r.IntervalSeconds,
		Version:         r.Version,
		UID:             r.UID,
		NamespaceUID:    r.NamespaceUID,
		RuleGroup:       r.RuleGroup,
		RuleGroupIndex:  r.RuleGroupIndex,
		NoDataState:     r.NoDataState,
		ExecErrState:    r.ExecErrState,
		For:             r.For,
	}

	if r.DashboardUID != nil {
		dash := *r.DashboardUID
		result.DashboardUID = &dash
	}
	if r.PanelID != nil {
		p := *r.PanelID
		result.PanelID = &p
	}

	for _, d := range r.Data {
		q := AlertQuery{
			RefID:             d.RefID,
			QueryType:         d.QueryType,
			RelativeTimeRange: d.RelativeTimeRange,
			DatasourceUID:     d.DatasourceUID,
		}
		q.Model = make([]byte, 0, cap(d.Model))
		q.Model = append(q.Model, d.Model...)
		result.Data = append(result.Data, q)
	}

	if r.Annotations != nil {
		result.Annotations = make(map[string]string, len(r.Annotations))
		for s, s2 := range r.Annotations {
			result.Annotations[s] = s2
		}
	}

	if r.Labels != nil {
		result.Labels = make(map[string]string, len(r.Labels))
		for s, s2 := range r.Labels {
			result.Labels[s] = s2
		}
	}

	for _, s := range r.NotificationSettings {
		result.NotificationSettings = append(result.NotificationSettings, CopyNotificationSettings(s))
	}

	if len(mutators) > 0 {
		g := NewAlertRuleGenerator(nil, "copy-")
		for _, mutator := range mutators {
			mutator(g, r)
		}
	}

	return &result
}

func CreateClassicConditionExpression(refID string, inputRefID string, reducer string, operation string, threshold int) AlertQuery {
	return AlertQuery{
		RefID:         refID,
		QueryType:     expr.DatasourceType,
		DatasourceUID: expr.DatasourceUID,
		// the format corresponds to model `ClassicConditionJSON` in /pkg/expr/classic/classic.go
		Model: json.RawMessage(fmt.Sprintf(`
		{
			"refId": "%[1]s",
            "hide": false,
            "type": "classic_conditions",
            "datasource": {
                "uid": "%[6]s",
                "type": "%[7]s"
            },
            "conditions": [
                {
                    "type": "query",
                    "evaluator": {
                        "params": [
                            %[4]d
                        ],
                        "type": "%[3]s"
                    },
                    "operator": {
                        "type": "and"
                    },
                    "query": {
                        "params": [
                            "%[2]s"
                        ]
                    },
                    "reducer": {
                        "params": [],
                        "type": "%[5]s"
                    }
                }
            ]
		}`, refID, inputRefID, operation, threshold, reducer, expr.DatasourceUID, expr.DatasourceType)),
	}
}

func CreateReduceExpression(refID string, inputRefID string, reducer string) AlertQuery {
	return AlertQuery{
		RefID:         refID,
		QueryType:     expr.DatasourceType,
		DatasourceUID: expr.DatasourceUID,
		Model: json.RawMessage(fmt.Sprintf(`
		{
			"refId": "%[1]s",
            "hide": false,
            "type": "reduce",
			"expression": "%[2]s",
			"reducer": "%[3]s",
            "datasource": {
                "uid": "%[4]s",
                "type": "%[5]s"
            }
		}`, refID, inputRefID, reducer, expr.DatasourceUID, expr.DatasourceType)),
	}
}

func CreatePrometheusQuery(refID string, expr string, intervalMs int64, maxDataPoints int64, isInstant bool, datasourceUID string) AlertQuery {
	return AlertQuery{
		RefID:         refID,
		QueryType:     "",
		DatasourceUID: datasourceUID,
		Model: json.RawMessage(fmt.Sprintf(`
		{
			"refId": "%[1]s",
			"expr": "%[2]s",
            "intervalMs": %[3]d,
            "maxDataPoints": %[4]d,
			"exemplar": false,
			"instant": %[5]t,
			"range": %[6]t,
            "datasource": {
                "uid": "%[7]s",
                "type": "%[8]s"
            }
		}`, refID, expr, intervalMs, maxDataPoints, isInstant, !isInstant, datasourceUID, datasources.DS_PROMETHEUS)),
	}
}

func CreateLokiQuery(refID string, expr string, intervalMs int64, maxDataPoints int64, queryType string, datasourceUID string) AlertQuery {
	return AlertQuery{
		RefID:         refID,
		QueryType:     queryType,
		DatasourceUID: datasourceUID,
		Model: json.RawMessage(fmt.Sprintf(`
		{
			"refId": "%[1]s",
			"expr": "%[2]s",
            "intervalMs": %[3]d,
            "maxDataPoints": %[4]d,
			"queryType": "%[5]s",
            "datasource": {
                "uid": "%[6]s",
                "type": "%[7]s"
            }
		}`, refID, expr, intervalMs, maxDataPoints, queryType, datasourceUID, datasources.DS_LOKI)),
	}
}

func CreateHysteresisExpression(t *testing.T, refID string, inputRefID string, threshold int, recoveryThreshold int) AlertQuery {
	t.Helper()
	q := AlertQuery{
		RefID:         refID,
		QueryType:     expr.DatasourceType,
		DatasourceUID: expr.DatasourceUID,
		Model: json.RawMessage(fmt.Sprintf(`
		{
			"refId": "%[1]s",
            "type": "threshold",
            "datasource": {
                "uid": "%[5]s",
                "type": "%[6]s"
            },
			"expression": "%[2]s",
            "conditions": [
                {
                    "type": "query",
                    "evaluator": {
                        "params": [
                            %[3]d
                        ],
                        "type": "gt"
                    },
					"unloadEvaluator": {
                        "params": [
                            %[4]d
                        ],
                        "type": "lt"
					}
                }
            ]
		}`, refID, inputRefID, threshold, recoveryThreshold, expr.DatasourceUID, expr.DatasourceType)),
	}
	h, err := q.IsHysteresisExpression()
	require.NoError(t, err)
	require.Truef(t, h, "test model is expected to be a hysteresis expression")
	return q
}

type AlertInstanceMutator func(*AlertInstance)

// AlertInstanceGen provides a factory function that generates a random AlertInstance.
// The mutators arguments allows changing fields of the resulting structure.
func AlertInstanceGen(mutators ...AlertInstanceMutator) *AlertInstance {
	var labels map[string]string = nil
	if rand.Int63()%2 == 0 {
		labels = GenerateAlertLabels(rand.Intn(5), "lbl-")
	}

	randState := func() InstanceStateType {
		s := [...]InstanceStateType{
			InstanceStateFiring,
			InstanceStateNormal,
			InstanceStatePending,
			InstanceStateNoData,
			InstanceStateError,
		}
		return s[rand.Intn(len(s))]
	}

	currentStateSince := time.Now().Add(-time.Duration(rand.Intn(100) + 1))

	instance := &AlertInstance{
		AlertInstanceKey: AlertInstanceKey{
			RuleOrgID:  rand.Int63n(1500),
			RuleUID:    util.GenerateShortUID(),
			LabelsHash: util.GenerateShortUID(),
		},
		Labels:            labels,
		CurrentState:      randState(),
		CurrentReason:     "TEST-REASON-" + util.GenerateShortUID(),
		CurrentStateSince: currentStateSince,
		CurrentStateEnd:   currentStateSince.Add(time.Duration(rand.Intn(100) + 200)),
		LastEvalTime:      time.Now().Add(-time.Duration(rand.Intn(100) + 50)),
	}

	for _, mutator := range mutators {
		mutator(instance)
	}
	return instance
}

type Mutator[T any] func(*T)

// CopyNotificationSettings creates a deep copy of NotificationSettings.
func CopyNotificationSettings(ns NotificationSettings, mutators ...Mutator[NotificationSettings]) NotificationSettings {
	c := NotificationSettings{
		Receiver: ns.Receiver,
	}
	if ns.GroupWait != nil {
		c.GroupWait = util.Pointer(*ns.GroupWait)
	}
	if ns.GroupInterval != nil {
		c.GroupInterval = util.Pointer(*ns.GroupInterval)
	}
	if ns.RepeatInterval != nil {
		c.RepeatInterval = util.Pointer(*ns.RepeatInterval)
	}
	if ns.GroupBy != nil {
		c.GroupBy = make([]string, len(ns.GroupBy))
		copy(c.GroupBy, ns.GroupBy)
	}
	if ns.MuteTimeIntervals != nil {
		c.MuteTimeIntervals = make([]string, len(ns.MuteTimeIntervals))
		copy(c.MuteTimeIntervals, ns.MuteTimeIntervals)
	}
	for _, mutator := range mutators {
		mutator(&c)
	}
	return c
}

// NotificationSettingsGen generates NotificationSettings using a base and mutators.
func NotificationSettingsGen(mutators ...Mutator[NotificationSettings]) func() NotificationSettings {
	return func() NotificationSettings {
		c := NotificationSettings{
			Receiver:          util.GenerateShortUID(),
			GroupBy:           []string{model.AlertNameLabel, FolderTitleLabel, util.GenerateShortUID()},
			GroupWait:         util.Pointer(model.Duration(time.Duration(rand.Intn(100)+1) * time.Second)),
			GroupInterval:     util.Pointer(model.Duration(time.Duration(rand.Intn(100)+1) * time.Second)),
			RepeatInterval:    util.Pointer(model.Duration(time.Duration(rand.Intn(100)+1) * time.Second)),
			MuteTimeIntervals: []string{util.GenerateShortUID(), util.GenerateShortUID()},
		}
		for _, mutator := range mutators {
			mutator(&c)
		}
		return c
	}
}

var (
	NSMuts = NotificationSettingsMutators{}
)

type NotificationSettingsMutators struct{}

func (n NotificationSettingsMutators) WithReceiver(receiver string) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		ns.Receiver = receiver
	}
}

func (n NotificationSettingsMutators) WithGroupWait(groupWait *time.Duration) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		if groupWait == nil {
			ns.GroupWait = nil
			return
		}
		dur := model.Duration(*groupWait)
		ns.GroupWait = &dur
	}
}

func (n NotificationSettingsMutators) WithGroupInterval(groupInterval *time.Duration) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		if groupInterval == nil {
			ns.GroupInterval = nil
			return
		}
		dur := model.Duration(*groupInterval)
		ns.GroupInterval = &dur
	}
}

func (n NotificationSettingsMutators) WithRepeatInterval(repeatInterval *time.Duration) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		if repeatInterval == nil {
			ns.RepeatInterval = nil
			return
		}
		dur := model.Duration(*repeatInterval)
		ns.RepeatInterval = &dur
	}
}

func (n NotificationSettingsMutators) WithGroupBy(groupBy ...string) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		ns.GroupBy = groupBy
	}
}

func (n NotificationSettingsMutators) WithMuteTimeIntervals(muteTimeIntervals ...string) Mutator[NotificationSettings] {
	return func(ns *NotificationSettings) {
		ns.MuteTimeIntervals = muteTimeIntervals
	}
}
